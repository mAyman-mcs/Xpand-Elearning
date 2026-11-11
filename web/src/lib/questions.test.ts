import { describe, expect, it } from "vitest";
import {
  blocksOf,
  changeType,
  contentBlocks,
  inOrder,
  moveBlock,
  moveBlockTo,
  NEW_QUESTION,
  optionLetter,
  questionProblems,
  questionTypesFor,
} from "./questions";

const filled = {
  ...NEW_QUESTION,
  text: "Q?",
  options: [
    { text: "A", isCorrect: true },
    { text: "B", isCorrect: false },
  ],
};

describe("questionProblems (mirrors the server)", () => {
  it("accepts a valid question and lists every problem of an invalid one", () => {
    expect(questionProblems(filled)).toEqual([]);
    expect(questionProblems(NEW_QUESTION)).toEqual(["The question has no text.", "An option has no text or picture."]);
    expect(
      questionProblems({
        ...filled,
        type: "MULTI_CHOICE",
        options: filled.options.map((o) => ({ ...o, isCorrect: false })),
      }),
    ).toEqual(["Mark at least one option as correct."]);
  });
});

describe("changeType", () => {
  it("true/false gets its two fixed options", () => {
    expect(changeType(filled, "TRUE_FALSE").options).toEqual([
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ]);
  });

  it("single choice keeps only the first correct option", () => {
    const multi = {
      ...filled,
      type: "MULTI_CHOICE" as const,
      options: filled.options.map((o) => ({ ...o, isCorrect: true })),
    };
    expect(changeType(multi, "SINGLE_CHOICE").options.map((o) => o.isCorrect)).toEqual([true, false]);
  });

  it("multiple choice keeps everything", () => {
    expect(changeType(filled, "MULTI_CHOICE").options).toEqual(filled.options);
  });
});

describe("essay questions", () => {
  it("have no options, and switching back to a choice type starts from blank options", () => {
    const essay = changeType(filled, "ESSAY");
    expect(essay.options).toEqual([]);
    expect(questionProblems(essay)).toEqual([]);
    expect(questionProblems({ ...essay, options: filled.options })).toEqual(["Essay questions have no options."]);

    const back = changeType({ ...essay, guidance: "notes" }, "SINGLE_CHOICE");
    expect(back.guidance).toBeNull();
    expect(back.options).toHaveLength(NEW_QUESTION.options.length);
  });

  it("are offered only in MCQ + essay exams", () => {
    expect(questionTypesFor("MCQ")).not.toContain("ESSAY");
    expect(questionTypesFor("MCQ_ESSAY")).toContain("ESSAY");
  });
});

describe("pictures", () => {
  it("an option may be a picture, with alt text", () => {
    const pic = {
      ...filled,
      options: [{ text: "", imageId: "p", imageAlt: "Diagram", isCorrect: true }, filled.options[1]!],
    };
    expect(questionProblems(pic)).toEqual([]);
    expect(
      questionProblems({ ...pic, options: [{ text: "", imageId: "p", isCorrect: true }, filled.options[1]!] }),
    ).toEqual(["Describe every option picture (alt text)."]);
  });
  it("letters options A, B, C", () => {
    expect([0, 1, 2, 25].map(optionLetter)).toEqual(["A", "B", "C", "Z"]);
  });
});

describe("case blocks", () => {
  const q = (id: string, caseId: string | null) =>
    ({
      ...NEW_QUESTION,
      id,
      caseId,
      position: 0,
      imageId: null,
      imageAlt: null,
      answerSize: "LONG",
      options: [],
    }) as never;
  const caseA = { id: "A", label: null, title: "A", situation: "s", hint: null, imageId: null, imageAlt: null };
  const caseB = { ...caseA, id: "B", title: "B" };
  const questions = [q("1", null), q("2", "A"), q("3", "A"), q("4", null)];

  it("groups a case's consecutive questions and lists empty cases last", () => {
    expect(blocksOf(questions as { caseId: string | null }[]).map((b) => b.length)).toEqual([1, 2, 1]);
    const blocks = contentBlocks(questions, [caseA, caseB]);
    expect(blocks.map((b) => [b.case?.id ?? null, b.questions.length])).toEqual([
      [null, 1],
      ["A", 2],
      [null, 1],
      ["B", 0],
    ]);
  });

  it("moves a whole case", () => {
    const blocks = contentBlocks(questions, [caseA, caseB]);
    expect(moveBlock(blocks, 1, -1)).toEqual(["2", "3", "1", "4"]);
    expect(moveBlock(blocks, 1, 1)).toEqual(["1", "4", "2", "3"]);
    expect(moveBlock(blocks, 0, -1)).toBeNull();
  });

  it("moves a block straight to any position, the case as a whole", () => {
    const blocks = contentBlocks(questions, [caseA, caseB]);
    // Blocks: [1], [2, 3], [4] (case B has no questions and doesn't count).
    expect(moveBlockTo(blocks, 2, 0)).toEqual(["4", "1", "2", "3"]);
    expect(moveBlockTo(blocks, 0, 2)).toEqual(["2", "3", "4", "1"]);
    expect(moveBlockTo(blocks, 1, 1)).toBeNull();
    expect(moveBlockTo(blocks, 0, 3)).toBeNull();
  });

  it("orders questions by a new id list", () => {
    expect(inOrder([{ id: "a" }, { id: "b" }, { id: "c" }], ["c", "a", "b"]).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

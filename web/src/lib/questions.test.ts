import { describe, expect, it } from "vitest";
import { changeType, NEW_QUESTION, questionProblems } from "./questions";

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
    expect(questionProblems(NEW_QUESTION)).toEqual(["The question has no text.", "An option has no text."]);
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

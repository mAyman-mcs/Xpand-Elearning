import { describe, expect, it } from "vitest";
import { publishProblems, questionProblems, type QuestionShape } from "./content.service.js";

const q = (over: Partial<QuestionShape>): QuestionShape => ({
  type: "SINGLE_CHOICE",
  text: "Which port does HTTPS use?",
  points: 1,
  options: [
    { text: "443", isCorrect: true },
    { text: "80", isCorrect: false },
  ],
  ...over,
});

describe("questionProblems", () => {
  it("accepts valid questions of every type", () => {
    expect(questionProblems(q({}))).toEqual([]);
    expect(
      questionProblems(
        q({
          type: "MULTI_CHOICE",
          options: [
            { text: "a", isCorrect: true },
            { text: "b", isCorrect: true },
          ],
        }),
      ),
    ).toEqual([]);
    expect(
      questionProblems(
        q({
          type: "TRUE_FALSE",
          options: [
            { text: "True", isCorrect: false },
            { text: "False", isCorrect: true },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "single choice with two correct",
      q({
        options: [
          { text: "a", isCorrect: true },
          { text: "b", isCorrect: true },
        ],
      }),
      "Mark exactly one option as correct.",
    ],
    [
      "single choice with none correct",
      q({
        options: [
          { text: "a", isCorrect: false },
          { text: "b", isCorrect: false },
        ],
      }),
      "Mark exactly one option as correct.",
    ],
    [
      "multi choice with none correct",
      q({
        type: "MULTI_CHOICE",
        options: [
          { text: "a", isCorrect: false },
          { text: "b", isCorrect: false },
        ],
      }),
      "Mark at least one option as correct.",
    ],
    ["one option only", q({ options: [{ text: "a", isCorrect: true }] }), "Give between 2 and 10 options."],
    [
      "eleven options",
      q({ options: Array.from({ length: 11 }, (_, i) => ({ text: `o${i}`, isCorrect: i === 0 })) }),
      "Give between 2 and 10 options.",
    ],
    [
      "true/false with three options",
      q({
        type: "TRUE_FALSE",
        options: [
          { text: "T", isCorrect: true },
          { text: "F", isCorrect: false },
          { text: "?", isCorrect: false },
        ],
      }),
      "True/false questions have exactly 2 options.",
    ],
    [
      "blank option",
      q({
        options: [
          { text: "a", isCorrect: true },
          { text: " ", isCorrect: false },
        ],
      }),
      "An option has no text.",
    ],
    [
      "true/false with both marked correct",
      q({
        type: "TRUE_FALSE",
        options: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: true },
        ],
      }),
      "Mark exactly one option as correct.",
    ],
    ["zero points", q({ points: 0 }), "Points must be more than 0."],
    ["blank text", q({ text: "  " }), "The question has no text."],
  ])("refuses %s", (_name, question, problem) => {
    expect(questionProblems(question)).toContain(problem);
  });
});

describe("essay questions", () => {
  const essay = (over: Partial<QuestionShape> = {}) => q({ type: "ESSAY", options: [], ...over });

  it("need text and points, and no options", () => {
    expect(questionProblems(essay())).toEqual([]);
    expect(questionProblems(essay({ text: " ", points: 0 }))).toEqual([
      "The question has no text.",
      "Points must be more than 0.",
    ]);
    expect(questionProblems(essay({ options: [{ text: "x", isCorrect: true }] }))).toEqual([
      "Essay questions have no options.",
    ]);
  });
});

describe("publishProblems", () => {
  const exam = { isExternal: false, questionsPerAttempt: null, type: "MCQ" as const };

  it("needs at least one valid question", () => {
    expect(publishProblems(exam, [])).toEqual(["Add at least one question."]);
    expect(publishProblems(exam, [q({}), q({ points: 0 })])).toEqual(["Question 2: Points must be more than 0."]);
    expect(publishProblems(exam, [q({})])).toEqual([]);
  });

  it("external exams have no questions to check", () => {
    expect(publishProblems({ ...exam, isExternal: true }, [])).toEqual([]);
  });

  it("refuses questions per attempt until question pools exist", () => {
    expect(publishProblems({ ...exam, questionsPerAttempt: 5 }, [q({})])).toEqual([
      "“Questions per attempt” must be empty until question pools arrive.",
    ]);
  });

  it("refuses essays in an MCQ exam", () => {
    expect(publishProblems(exam, [q({ type: "ESSAY", options: [] })])).toEqual([
      "Question 1: Essay questions need the “Multiple choice + essay” exam type.",
    ]);
  });

  it("needs at least one essay in an MCQ + essay exam (T2)", () => {
    const essayExam = { ...exam, type: "MCQ_ESSAY" as const };
    expect(publishProblems(essayExam, [q({})])).toEqual([
      "Add at least one essay question, or change the exam type to “Multiple choice only”.",
    ]);
    expect(publishProblems(essayExam, [q({}), q({ type: "ESSAY", options: [] })])).toEqual([]);
    expect(publishProblems(essayExam, [q({ type: "ESSAY", options: [] })])).toEqual([]);
  });
});

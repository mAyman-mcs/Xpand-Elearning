import { describe, expect, it } from "vitest";
import { approvalProblems, finalScore, gradeProblem, type GradedAnswer, type GradedQuestion } from "./rules.js";

const essay = { type: "ESSAY" as const, points: 5 };
const choice = { type: "SINGLE_CHOICE" as const, points: 1.25 };

describe("gradeProblem", () => {
  it("accepts 0 to the maximum in steps of 0.5 (T7)", () => {
    expect(gradeProblem(essay, 0, null, undefined)).toBeNull();
    expect(gradeProblem(essay, 3.5, null, undefined)).toBeNull();
    expect(gradeProblem(essay, 5, null, undefined)).toBeNull();
    expect(gradeProblem(essay, 3.25, null, undefined)).toMatch(/steps of 0.5/);
    expect(gradeProblem(essay, 5.5, null, undefined)).toMatch(/between 0 and 5/);
    expect(gradeProblem(essay, -1, null, undefined)).toMatch(/between 0 and 5/);
    expect(gradeProblem(essay, Number.NaN, null, undefined)).toMatch(/between 0 and 5/);
  });

  it("always allows a question's own maximum, even off the 0.5 step", () => {
    expect(gradeProblem(choice, 1.25, 1.25, undefined)).toBeNull();
  });

  it("needs a reason to override the automatic points of a choice question (T5)", () => {
    expect(gradeProblem(choice, 0, 1.25, undefined)).toMatch(/needs a reason/);
    expect(gradeProblem(choice, 0, 1.25, "  ")).toMatch(/needs a reason/);
    expect(gradeProblem(choice, 0, 1.25, "Answer key was wrong")).toBeNull();
    // Unanswered (no automatic points) counts as 0: confirming 0 is not an override.
    expect(gradeProblem(choice, 0, null, undefined)).toBeNull();
    expect(gradeProblem(choice, 1, null, undefined)).toMatch(/needs a reason/);
  });
});

const questions: GradedQuestion[] = [
  { id: "c1", type: "SINGLE_CHOICE", points: 1 },
  { id: "e1", type: "ESSAY", points: 5 },
  { id: "e2", type: "ESSAY", points: 5 },
];
const answers = (entries: [string, Partial<GradedAnswer>][]) =>
  new Map(entries.map(([id, a]) => [id, { answered: true, autoPoints: null, awardedPoints: null, ...a }]));

describe("approvalProblems", () => {
  it("lists answered essays without points", () => {
    expect(approvalProblems(questions, answers([["e1", {}]]))).toEqual(["Give points for question 2."]);
    expect(
      approvalProblems(
        questions,
        answers([
          ["e1", {}],
          ["e2", {}],
        ]),
      ),
    ).toEqual(["Give points for questions 2, 3."]);
  });

  it("needs nothing for unanswered essays or choice questions", () => {
    expect(
      approvalProblems(
        questions,
        answers([
          ["c1", { autoPoints: 0 }],
          ["e1", { answered: false }],
        ]),
      ),
    ).toEqual([]);
    expect(approvalProblems(questions, new Map())).toEqual([]);
    expect(approvalProblems(questions, answers([["e1", { awardedPoints: 0 }]]))).toEqual([]);
  });
});

describe("finalScore", () => {
  it("adds grader points, else automatic points, else 0", () => {
    expect(
      finalScore(
        questions,
        answers([
          ["c1", { autoPoints: 1 }],
          ["e1", { awardedPoints: 3.5 }],
        ]),
      ),
    ).toBe(4.5);
  });

  it("prefers an override to the automatic points", () => {
    expect(finalScore(questions, answers([["c1", { autoPoints: 1, awardedPoints: 0 }]]))).toBe(0);
  });

  it("rounds to cents", () => {
    const thirds: GradedQuestion[] = [1, 2, 3].map((i) => ({ id: `q${i}`, type: "SINGLE_CHOICE", points: 1 }));
    const a = answers(thirds.map((q) => [q.id, { autoPoints: 0.333 }]));
    expect(finalScore(thirds, a)).toBe(1);
  });
});

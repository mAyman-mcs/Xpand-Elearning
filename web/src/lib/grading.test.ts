import type { GradingAttempt, GradingQuestion } from "@contracts";
import { describe, expect, it } from "vitest";
import { changedGrades, draftProblems, draftsOf, draftTotal } from "./grading";

const question = (over: Partial<GradingQuestion>): GradingQuestion => ({
  index: 0,
  id: "q",
  type: "ESSAY",
  text: "Explain.",
  imageUrl: null,
  points: 5,
  guidance: null,
  options: [],
  answerText: "An answer",
  answered: true,
  autoPoints: null,
  awardedPoints: null,
  overrideReason: null,
  feedback: null,
  gradedBy: null,
  gradedAt: null,
  ...over,
});

const attempt = (questions: GradingQuestion[]): GradingAttempt => ({
  attemptId: "a",
  attemptNo: 1,
  status: "SUBMITTED",
  submittedAt: null,
  submitReason: null,
  reviewStatus: "PENDING",
  reviewedBy: null,
  reviewedAt: null,
  gradingVersion: 0,
  score: null,
  maxScore: 11,
  exam: { id: "e", code: "E", title: "E", scoringMode: "MANUAL_APPROVAL" },
  student: { id: "s", username: "s", fullName: "S" },
  questions,
  approvalProblems: [],
  nextUngradedId: null,
});

const a = attempt([
  question({ id: "c1", type: "SINGLE_CHOICE", points: 1, autoPoints: 1 }),
  question({ id: "e1" }),
  question({ id: "e2", answered: false, answerText: null }),
]);

describe("grading drafts", () => {
  it("start from the server: choice points filled in, ungraded essays empty", () => {
    expect(draftsOf(a)).toEqual({
      c1: { points: "1", feedback: "", reason: "" },
      e1: { points: "", feedback: "", reason: "" },
      e2: { points: "", feedback: "", reason: "" },
    });
  });

  it("need points for answered essays before approval; unanswered ones count as 0", () => {
    const drafts = draftsOf(a);
    expect(draftProblems(a, drafts)).toEqual(["Give points for question 2."]);
    expect(draftProblems(a, { ...drafts, e1: { ...drafts.e1!, points: "3.5" } })).toEqual([]);
  });

  it("check points like the server: range, half steps, overrides with a reason", () => {
    const drafts = draftsOf(a);
    const one = (id: string, points: string, reason = "") =>
      draftProblems(a, { ...drafts, e1: { ...drafts.e1!, points: "1" }, [id]: { ...drafts[id]!, points, reason } });
    expect(one("e1", "6")).toEqual(["Question 2: Give between 0 and 5 points."]);
    expect(one("e1", "2.25")).toEqual(["Question 2: Give points in steps of 0.5."]);
    expect(one("e2", "1")).toEqual(["Question 3: Not answered: it can only get 0 points."]);
    expect(one("c1", "0")).toEqual(["Question 1: Changing the automatic points needs a reason."]);
    expect(one("c1", "0", "Key was wrong")).toEqual([]);
  });

  it("send only what changed", () => {
    const drafts = draftsOf(a);
    expect(changedGrades(a, drafts)).toEqual([]);
    expect(
      changedGrades(a, {
        ...drafts,
        e1: { points: "4", feedback: " Good ", reason: "" },
        c1: { points: "0", feedback: "", reason: "Key" },
      }),
    ).toEqual([
      { questionId: "c1", points: 0, feedback: null, reason: "Key" },
      { questionId: "e1", points: 4, feedback: "Good" },
    ]);
  });

  it("total the draft", () => {
    const drafts = draftsOf(a);
    expect(draftTotal(a, drafts)).toBe(1);
    expect(draftTotal(a, { ...drafts, e1: { ...drafts.e1!, points: "3.5" } })).toBe(4.5);
  });
});

import { describe, expect, it } from "vitest";
import { pendingResultText, scoreSummary } from "./StudentHome";

describe("a score against the pass mark", () => {
  it("passes at or above the pass mark", () => {
    expect(scoreSummary(16, 20, 80)).toEqual({ percent: 80, passed: true });
    expect(scoreSummary(14, 20, 80)).toEqual({ percent: 70, passed: false });
  });

  it("compares the exact percentage, not the rounded one", () => {
    // 79.6% shows as 80% but is below an 80% pass mark.
    expect(scoreSummary(19.9, 25, 80)).toEqual({ percent: 80, passed: false });
  });

  it("copes with an empty exam", () => {
    expect(scoreSummary(0, 0, 50)).toEqual({ percent: 0, passed: false });
  });
});

describe("pendingResultText", () => {
  it("says whether the student waits for grading or for staff to share the results", () => {
    expect(pendingResultText(true, false)).toMatch(/being graded.*instructor shares the results/);
    expect(pendingResultText(true, true)).toMatch(/being graded.*when grading is finished/);
    expect(pendingResultText(false, false)).toMatch(/once your instructor shares the results/);
    expect(pendingResultText(false, true)).toBe("Submitted. Your result isn't available yet.");
  });
});

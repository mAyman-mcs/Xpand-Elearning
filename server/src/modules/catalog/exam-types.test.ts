import { describe, expect, it } from "vitest";
import { defaultScoringMode, isChoice, questionAllowed, scoringProblem } from "./exam-types.js";

describe("exam types and scoring modes", () => {
  it("MCQ exams may be auto scored or need approval; essay exams only need approval", () => {
    expect(scoringProblem("MCQ", "AUTO")).toBeNull();
    expect(scoringProblem("MCQ", "MANUAL_APPROVAL")).toBeNull();
    expect(scoringProblem("MCQ_ESSAY", "MANUAL_APPROVAL")).toBeNull();
    expect(scoringProblem("MCQ_ESSAY", "AUTO")).toMatch(/can't be auto scored/);
  });

  it("defaults to the mode the type allows", () => {
    expect(defaultScoringMode("MCQ")).toBe("AUTO");
    expect(defaultScoringMode("MCQ_ESSAY")).toBe("MANUAL_APPROVAL");
  });

  it("allows essays only in MCQ + essay exams", () => {
    expect(questionAllowed("MCQ", "ESSAY")).toBe(false);
    expect(questionAllowed("MCQ_ESSAY", "ESSAY")).toBe(true);
    expect(questionAllowed("MCQ", "SINGLE_CHOICE")).toBe(true);
    expect(questionAllowed("MCQ_ESSAY", "TRUE_FALSE")).toBe(true);
  });

  it("knows which types are graded from options", () => {
    expect(isChoice("MULTI_CHOICE")).toBe(true);
    expect(isChoice("ESSAY")).toBe(false);
  });
});

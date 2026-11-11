import { describe, expect, it } from "vitest";
import { setupSteps } from "./SetupChecklist";

const base = { examId: "e1", isExternal: false, publishProblems: [] as string[], assigned: true, published: false };
const state = (o: Partial<typeof base> & { assigned?: boolean | null; publishProblems?: string[] | undefined }) =>
  setupSteps({ ...base, ...o }).map((s) => [s.key, s.done]);

describe("the setup checklist", () => {
  it("lists questions, assigned and published, in that order", () => {
    expect(state({ publishProblems: ["Add at least one question."], assigned: false })).toEqual([
      ["questions", false],
      ["assigned", false],
      ["published", false],
    ]);
    expect(state({})).toEqual([
      ["questions", true],
      ["assigned", true],
      ["published", false],
    ]);
  });

  it("says what blocks the questions step", () => {
    const [questions] = setupSteps({ ...base, publishProblems: ["Question 2 has no correct option."] });
    expect(questions?.detail).toBe("Question 2 has no correct option.");
    expect(questions?.to).toBe("/exams/e1/questions");
  });

  it("skips questions for an external exam", () => {
    expect(state({ isExternal: true }).map(([key]) => key)).toEqual(["assigned", "published"]);
  });

  it("points elsewhere when the caller can't assign", () => {
    const assigned = setupSteps({ ...base, assigned: null }).find((s) => s.key === "assigned");
    expect(assigned?.done).toBe(false);
    expect(assigned?.to).toBeUndefined();
    expect(assigned?.detail).toMatch(/Assign permission/);
  });
});

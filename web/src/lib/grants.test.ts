import type { GrantScopeFields } from "@contracts";
import { describe, expect, it } from "vitest";
import { grantSentence, joinList } from "./grants";

const names = {
  exams: new Map([
    ["e1", "Cloud Gates"],
    ["e2", "Routing"],
  ]),
  categories: new Map([["c1", "Cloud"]]),
  tags: new Map([
    ["t1", "soc"],
    ["t2", "network"],
  ]),
  groups: new Map([
    ["g1", "Intake July 2026"],
    ["g2", "Intake Oct 2026"],
  ]),
};
const grant = (over: Partial<GrantScopeFields>): GrantScopeFields => ({
  permissions: ["EXAM_ASSIGN"],
  allExams: false,
  examIds: [],
  categoryIds: [],
  tagIds: [],
  allGroups: false,
  groupIds: [],
  studentsWhoSubmitted: false,
  expiresAt: null,
  ...over,
});

describe("grantSentence", () => {
  it("reads like the frontend guide's example", () => {
    expect(
      grantSentence(
        grant({
          permissions: ["RESULTS_VIEW", "EXAM_SCHEDULE"],
          categoryIds: ["c1"],
          groupIds: ["g1"],
          expiresAt: "2026-12-31T21:59:00.000Z",
        }),
        names,
      ),
    ).toBe(
      "Can view results and schedule and open/close exams for exams in Cloud, for students in Intake July 2026, until 31 Dec 2026, 23:59 Cairo.",
    );
  });

  it("combines categories and single exams, and lists several groups", () => {
    expect(grantSentence(grant({ categoryIds: ["c1"], examIds: ["e1", "e2"], groupIds: ["g1", "g2"] }), names)).toBe(
      "Can assign exams for exams in Cloud and the exams “Cloud Gates” and “Routing”, for students in Intake July 2026 and Intake Oct 2026.",
    );
  });

  it("all exams, every group, no expiry", () => {
    expect(grantSentence(grant({ allExams: true, allGroups: true }), names)).toBe(
      "Can assign exams for all exams, for students in every group.",
    );
  });

  it("names deleted records instead of failing", () => {
    expect(grantSentence(grant({ examIds: ["gone"], allGroups: true }), names)).toContain("“(deleted)”");
  });
});

describe("grantSentence with tags and submitted students", () => {
  it("names the tags (any of them) and the submitted-only student scope", () => {
    expect(
      grantSentence(grant({ permissions: ["RESULTS_VIEW"], tagIds: ["t1", "t2"], studentsWhoSubmitted: true }), names),
    ).toBe(
      "Can view results for exams tagged “soc” or “network”, for only students who have submitted one of these exams.",
    );
  });
});

describe("joinList", () => {
  it("joins with commas and 'and'", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});

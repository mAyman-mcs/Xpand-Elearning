import { describe, expect, it } from "vitest";
import { authorize, canSeeAnything, type GrantScope, type Principal } from "./authorize.js";

const NOW = new Date("2026-10-01T12:00:00Z");

const grant = (over: Partial<GrantScope>): GrantScope => ({
  permissions: ["RESULTS_VIEW"],
  allExams: false,
  examIds: [],
  categoryIds: [],
  allGroups: false,
  groupIds: [],
  expiresAt: null,
  ...over,
});
const instructor = (...grants: GrantScope[]): Principal => ({ userId: "i1", role: "INSTRUCTOR", grants });
const can = (
  p: Principal,
  scope: Parameters<typeof authorize>[2],
  perm: Parameters<typeof authorize>[1] = "RESULTS_VIEW",
) => authorize(p, perm, scope, NOW);

describe("authorize: roles", () => {
  it("lets a super admin do anything without grants", () => {
    const p: Principal = { userId: "a", role: "SUPER_ADMIN", grants: [] };
    expect(can(p, { examId: "e1", categoryId: "c1", groupIds: ["g1"] }, "ATTEMPT_VOID")).toBe(true);
  });

  it("never grants staff permissions to students, even with a stray grant row", () => {
    const p: Principal = { userId: "s", role: "STUDENT", grants: [grant({ allExams: true, allGroups: true })] };
    expect(can(p, {})).toBe(false);
  });

  it("gives an instructor without grants nothing", () => {
    expect(can(instructor(), {})).toBe(false);
  });
});

describe("authorize: exam scope", () => {
  const p = instructor(grant({ examIds: ["e1"], allGroups: true }));

  it("covers listed exams only", () => {
    expect(can(p, { examId: "e1", categoryId: "c1" })).toBe(true);
    expect(can(p, { examId: "e2", categoryId: "c1" })).toBe(false);
  });

  it("requires the specific permission", () => {
    expect(can(p, { examId: "e1", categoryId: "c1" }, "EXAM_SCHEDULE")).toBe(false);
  });

  it("covers every exam of a granted category, including ones created later (D5)", () => {
    const cat = instructor(grant({ categoryIds: ["cloud"], allGroups: true }));
    expect(can(cat, { examId: "any-new-exam", categoryId: "cloud" })).toBe(true);
    expect(can(cat, { examId: "e1", categoryId: "networking" })).toBe(false);
  });

  it("a category grant covers actions on the category itself; an exam grant does not", () => {
    expect(can(instructor(grant({ categoryIds: ["cloud"], allGroups: true })), { categoryId: "cloud" })).toBe(true);
    expect(can(p, { categoryId: "c1" })).toBe(false);
  });

  it("all-exams grants cover any exam and category", () => {
    expect(can(instructor(grant({ allExams: true, allGroups: true })), { examId: "x", categoryId: "y" })).toBe(true);
  });
});

describe("authorize: group scope", () => {
  const p = instructor(grant({ allExams: true, groupIds: ["gA"] }));

  it("covers listed groups only", () => {
    expect(can(p, { examId: "e", groupIds: ["gA"] })).toBe(true);
    expect(can(p, { examId: "e", groupIds: ["gB"] })).toBe(false);
  });

  it("covers a student in several groups when any of them is in scope (D6)", () => {
    expect(can(p, { groupIds: ["gB", "gA"] })).toBe(true);
    expect(can(p, { groupIds: ["gB", "gC"] })).toBe(false);
  });

  it("a student in no group is covered only by all-groups grants", () => {
    expect(can(p, { groupIds: [] })).toBe(false);
    expect(can(instructor(grant({ allExams: true, allGroups: true })), { groupIds: [] })).toBe(true);
  });
});

describe("authorize: grants are never combined", () => {
  const p = instructor(grant({ examIds: ["eA"], groupIds: ["gX"] }), grant({ examIds: ["eB"], groupIds: ["gY"] }));

  it("allows each grant's own pair", () => {
    expect(can(p, { examId: "eA", groupIds: ["gX"] })).toBe(true);
    expect(can(p, { examId: "eB", groupIds: ["gY"] })).toBe(true);
  });

  it("refuses cross pairs", () => {
    expect(can(p, { examId: "eA", groupIds: ["gY"] })).toBe(false);
    expect(can(p, { examId: "eB", groupIds: ["gX"] })).toBe(false);
  });

  it("does not combine a permission from one grant with the scope of another", () => {
    const q = instructor(
      grant({ permissions: ["RESULTS_VIEW"], examIds: ["e1"], allGroups: true }),
      grant({ permissions: ["EXAM_SCHEDULE"], examIds: ["e2"], allGroups: true }),
    );
    expect(can(q, { examId: "e1" }, "EXAM_SCHEDULE")).toBe(false);
  });
});

describe("authorize: expiry", () => {
  it("is valid until the exact expiry instant, and not at it", () => {
    const justAfter = instructor(grant({ allExams: true, allGroups: true, expiresAt: new Date(NOW.getTime() + 1) }));
    const exactly = instructor(grant({ allExams: true, allGroups: true, expiresAt: NOW }));
    expect(can(justAfter, {})).toBe(true);
    expect(can(exactly, {})).toBe(false);
  });
});

describe("canSeeAnything", () => {
  it("is true when any permission reaches the scope", () => {
    const p = instructor(grant({ permissions: ["AUDIT_VIEW"], examIds: ["e1"], allGroups: true }));
    expect(canSeeAnything(p, { examId: "e1" }, NOW)).toBe(true);
    expect(canSeeAnything(p, { examId: "e2" }, NOW)).toBe(false);
  });
});

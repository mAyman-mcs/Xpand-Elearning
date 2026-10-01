import { describe, expect, it } from "vitest";
import { authorize, type GrantScope, type Principal } from "./authorize.js";

const grant = (over: Partial<GrantScope>): GrantScope => ({
  permissions: ["RESULTS_VIEW"],
  allExams: false,
  allGroups: false,
  examIds: [],
  groupIds: [],
  expiresAt: null,
  ...over,
});

const instructor = (...grants: GrantScope[]): Principal => ({ userId: "i1", role: "INSTRUCTOR", grants });

describe("authorize", () => {
  it("lets a super admin do anything without grants", () => {
    const p: Principal = { userId: "a", role: "SUPER_ADMIN", grants: [] };
    expect(authorize(p, "ATTEMPT_VOID", { examId: "e1", groupId: "g1" })).toBe(true);
  });

  it("never grants staff permissions to students, even with a stray grant row", () => {
    const p: Principal = { userId: "s", role: "STUDENT", grants: [grant({ allExams: true, allGroups: true })] };
    expect(authorize(p, "RESULTS_VIEW")).toBe(false);
  });

  it("allows an instructor only on exams in scope", () => {
    const p = instructor(grant({ examIds: ["e1"], allGroups: true }));
    expect(authorize(p, "RESULTS_VIEW", { examId: "e1" })).toBe(true);
    expect(authorize(p, "RESULTS_VIEW", { examId: "e2" })).toBe(false);
  });

  it("requires the specific permission", () => {
    const p = instructor(grant({ examIds: ["e1"], allGroups: true }));
    expect(authorize(p, "EXAM_SCHEDULE", { examId: "e1" })).toBe(false);
  });

  it("restricts by group", () => {
    const p = instructor(grant({ allExams: true, groupIds: ["g1"] }));
    expect(authorize(p, "RESULTS_VIEW", { examId: "e9", groupId: "g1" })).toBe(true);
    expect(authorize(p, "RESULTS_VIEW", { examId: "e9", groupId: "g2" })).toBe(false);
  });

  it("does not combine exam scope from one grant with group scope from another", () => {
    const p = instructor(grant({ examIds: ["eA"], groupIds: ["gX"] }), grant({ examIds: ["eB"], groupIds: ["gY"] }));
    expect(authorize(p, "RESULTS_VIEW", { examId: "eA", groupId: "gX" })).toBe(true);
    expect(authorize(p, "RESULTS_VIEW", { examId: "eB", groupId: "gY" })).toBe(true);
    expect(authorize(p, "RESULTS_VIEW", { examId: "eA", groupId: "gY" })).toBe(false);
  });

  it("ignores expired grants", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const p = instructor(grant({ allExams: true, allGroups: true, expiresAt: new Date("2026-09-30T00:00:00Z") }));
    expect(authorize(p, "RESULTS_VIEW", {}, now)).toBe(false);
  });

  it("allows unscoped checks when any grant has the permission", () => {
    const p = instructor(grant({ examIds: ["e1"] }));
    expect(authorize(p, "RESULTS_VIEW")).toBe(true);
  });
});

import type { GrantScopeFields, MyPermissions } from "@contracts";
import { describe, expect, it } from "vitest";
import { can, hasAnyGrant } from "./permissions";

const grant = (over: Partial<GrantScopeFields>): GrantScopeFields => ({
  permissions: ["EXAM_ASSIGN"],
  allExams: false,
  examIds: [],
  categoryIds: [],
  tagIds: [],
  allGroups: true,
  groupIds: [],
  studentsWhoSubmitted: false,
  expiresAt: null,
  ...over,
});
const instructor = (...grants: GrantScopeFields[]): MyPermissions => ({ role: "INSTRUCTOR", grants });
const exam = { id: "e1", categoryId: "c1", tagIds: ["soc"] };

describe("can (UI visibility only)", () => {
  it("super admins can do everything; students and unknown callers nothing", () => {
    expect(can({ role: "SUPER_ADMIN", grants: [] }, "AUDIT_VIEW", exam)).toBe(true);
    expect(can({ role: "STUDENT", grants: [] }, "EXAM_EDIT")).toBe(false);
    expect(can(undefined, "EXAM_EDIT")).toBe(false);
  });

  it("instructors need the permission in a grant covering the exam (by id, category or all exams)", () => {
    expect(can(instructor(grant({ examIds: ["e1"] })), "EXAM_ASSIGN", exam)).toBe(true);
    expect(can(instructor(grant({ categoryIds: ["c1"] })), "EXAM_ASSIGN", exam)).toBe(true);
    expect(can(instructor(grant({ allExams: true })), "EXAM_ASSIGN", exam)).toBe(true);
    expect(can(instructor(grant({ tagIds: ["soc"] })), "EXAM_ASSIGN", exam)).toBe(true);
    expect(can(instructor(grant({ tagIds: ["network"] })), "EXAM_ASSIGN", exam)).toBe(false);
    expect(can(instructor(grant({ examIds: ["other"] })), "EXAM_ASSIGN", exam)).toBe(false);
    expect(can(instructor(grant({ allExams: true })), "EXAM_EDIT", exam)).toBe(false);
  });

  it("without an exam it asks whether any grant has the permission (menus)", () => {
    expect(can(instructor(grant({ examIds: ["x"], permissions: ["AUDIT_VIEW"] })), "AUDIT_VIEW")).toBe(true);
    expect(can(instructor(), "AUDIT_VIEW")).toBe(false);
  });

  it("hasAnyGrant", () => {
    expect(hasAnyGrant(instructor())).toBe(false);
    expect(hasAnyGrant(instructor(grant({})))).toBe(true);
    expect(hasAnyGrant({ role: "SUPER_ADMIN", grants: [] })).toBe(true);
  });
});

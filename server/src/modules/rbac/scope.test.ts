import { describe, expect, it } from "vitest";
import type { GrantScope, Principal } from "./authorize.js";
import { examWhere, groupWhere, reachOf, studentWhere } from "./scope.js";

const NOW = new Date("2026-10-01T12:00:00Z");
const NOTHING = { id: { in: [] } };
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
const reach = (role: Principal["role"], ...grants: GrantScope[]) =>
  reachOf({ userId: "u", role, grants }, "RESULTS_VIEW", NOW);

describe("Prisma filters", () => {
  it("super admins are unfiltered", () => {
    const r = reach("SUPER_ADMIN");
    expect(examWhere(r)).toEqual({});
    expect(groupWhere(r)).toEqual({});
    expect(studentWhere(r)).toEqual({ role: "STUDENT" });
  });

  it("students and grant-less instructors match nothing", () => {
    for (const r of [reach("STUDENT", grant({ allExams: true, allGroups: true })), reach("INSTRUCTOR")]) {
      expect(examWhere(r)).toEqual(NOTHING);
      expect(groupWhere(r)).toEqual(NOTHING);
      expect(studentWhere(r)).toEqual(NOTHING);
    }
  });

  it("combines exam and category lists with OR, and skips empty lists", () => {
    const r = reach("INSTRUCTOR", grant({ examIds: ["e1"] }), grant({ categoryIds: ["c1"] }));
    expect(examWhere(r)).toEqual({ OR: [{ id: { in: ["e1"] } }, { categoryId: { in: ["c1"] } }] });
  });

  it("an all-exams or all-groups grant lifts that side's filter", () => {
    const r = reach(
      "INSTRUCTOR",
      grant({ examIds: ["e1"], groupIds: ["g1"] }),
      grant({ allExams: true, allGroups: true }),
    );
    expect(examWhere(r)).toEqual({});
    expect(groupWhere(r)).toEqual({});
  });

  it("deduplicates groups across grants", () => {
    const r = reach("INSTRUCTOR", grant({ groupIds: ["g1", "g2"] }), grant({ groupIds: ["g2"] }));
    expect(groupWhere(r)).toEqual({ id: { in: ["g1", "g2"] } });
    expect(studentWhere(r)).toEqual({ role: "STUDENT", memberships: { some: { groupId: { in: ["g1", "g2"] } } } });
  });

  it("a grant with an exam scope but no groups reaches no students", () => {
    const r = reach("INSTRUCTOR", grant({ examIds: ["e1"] }));
    expect(studentWhere(r)).toEqual(NOTHING);
  });
});

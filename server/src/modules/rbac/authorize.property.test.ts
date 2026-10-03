import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Permission } from "../../generated/prisma/enums.js";
import { ALL_PERMISSIONS, authorize, type GrantScope, type Principal, type Scope } from "./authorize.js";
import { reachAllows, reachForExam, reachOf } from "./scope.js";

// Small id pools so random grants and scopes actually overlap.
const NOW = new Date("2026-10-01T12:00:00Z");
const exams = ["e1", "e2", "e3", "e4"];
const categories = ["c1", "c2"];
const categoryOf: Record<string, string> = { e1: "c1", e2: "c1", e3: "c2", e4: "c2" };
const groups = ["g1", "g2", "g3"];

const permission = fc.constantFrom(...ALL_PERMISSIONS);
const grantArb: fc.Arbitrary<GrantScope> = fc.record({
  permissions: fc.uniqueArray(permission, { minLength: 1, maxLength: 4 }),
  allExams: fc.boolean(),
  examIds: fc.subarray(exams),
  categoryIds: fc.subarray(categories),
  allGroups: fc.boolean(),
  groupIds: fc.subarray(groups),
  expiresAt: fc.option(fc.constantFrom(new Date(NOW.getTime() - 1000), NOW, new Date(NOW.getTime() + 1000)), {
    nil: null,
  }),
});
const principalArb: fc.Arbitrary<Principal> = fc.record({
  userId: fc.constant("u"),
  role: fc.constantFrom("SUPER_ADMIN" as const, "INSTRUCTOR" as const, "STUDENT" as const),
  grants: fc.array(grantArb, { maxLength: 4 }),
});
const instructorArb = principalArb.map((p) => ({ ...p, role: "INSTRUCTOR" as const }));
const scopeArb: fc.Arbitrary<Scope> = fc
  .record({
    exam: fc.option(fc.constantFrom(...exams), { nil: undefined }),
    groupIds: fc.option(fc.subarray(groups), { nil: undefined }),
  })
  .map(({ exam, groupIds }) => ({
    ...(exam ? { examId: exam, categoryId: categoryOf[exam] } : {}),
    ...(groupIds ? { groupIds } : {}),
  }));

const check = (prop: fc.IPropertyWithHooks<unknown[]> | fc.IAsyncPropertyWithHooks<unknown[]>) => {
  fc.assert(prop as fc.IProperty<unknown[]>, { numRuns: 2000 });
};

describe("authorize invariants", () => {
  it("super admins are always allowed and students never", () => {
    check(
      fc.property(principalArb, permission, scopeArb, (p, perm, scope) => {
        if (p.role === "SUPER_ADMIN") expect(authorize(p, perm, scope, NOW)).toBe(true);
        if (p.role === "STUDENT") expect(authorize(p, perm, scope, NOW)).toBe(false);
      }),
    );
  });

  it("an expired grant grants nothing", () => {
    check(
      fc.property(grantArb, permission, scopeArb, (g, perm, scope) => {
        const expired = { ...g, expiresAt: NOW };
        expect(authorize({ userId: "u", role: "INSTRUCTOR", grants: [expired] }, perm, scope, NOW)).toBe(false);
      }),
    );
  });

  it("adding a grant never removes access (monotonic)", () => {
    check(
      fc.property(instructorArb, grantArb, permission, scopeArb, (p, extra, perm, scope) => {
        if (authorize(p, perm, scope, NOW)) {
          expect(authorize({ ...p, grants: [...p.grants, extra] }, perm, scope, NOW)).toBe(true);
        }
      }),
    );
  });

  it("removing a grant never adds access", () => {
    check(
      fc.property(instructorArb, fc.nat(), permission, scopeArb, (p, i, perm, scope) => {
        if (p.grants.length === 0) return;
        const fewer = { ...p, grants: p.grants.filter((_, idx) => idx !== i % p.grants.length) };
        if (authorize(fewer, perm, scope, NOW)) expect(authorize(p, perm, scope, NOW)).toBe(true);
      }),
    );
  });

  it("access always comes from one single grant (never a combination)", () => {
    check(
      fc.property(instructorArb, permission, scopeArb, (p, perm, scope) => {
        const viaSingle = p.grants.some((g) => authorize({ ...p, grants: [g] }, perm, scope, NOW));
        expect(authorize(p, perm, scope, NOW)).toBe(viaSingle);
      }),
    );
  });

  it("narrowing the scope never removes access", () => {
    check(
      fc.property(instructorArb, permission, scopeArb, (p, perm, scope) => {
        if (authorize(p, perm, scope, NOW)) {
          expect(authorize(p, perm, {}, NOW)).toBe(true);
          if (scope.groupIds) expect(authorize(p, perm, { ...scope, groupIds: undefined }, NOW)).toBe(true);
        }
      }),
    );
  });
});

describe("list reach agrees with authorize", () => {
  it("reachOf(p, perm) allows exactly what authorize allows", () => {
    check(
      fc.property(principalArb, permission, scopeArb, (p, perm, scope) => {
        expect(reachAllows(reachOf(p, perm, NOW), scope)).toBe(authorize(p, perm, scope, NOW));
      }),
    );
  });

  it("reachOf(p, 'any') allows exactly what some permission allows", () => {
    check(
      fc.property(principalArb, scopeArb, (p, scope) => {
        const some = ALL_PERMISSIONS.some((perm: Permission) => authorize(p, perm, scope, NOW));
        expect(reachAllows(reachOf(p, "any", NOW), scope)).toBe(some);
      }),
    );
  });

  it("reachForExam keeps exactly the grants covering that exam", () => {
    check(
      fc.property(principalArb, permission, fc.constantFrom(...exams), fc.subarray(groups), (p, perm, exam, gs) => {
        const scope = { examId: exam, categoryId: categoryOf[exam], groupIds: gs };
        const forExam = reachForExam(reachOf(p, perm, NOW), { id: exam, categoryId: categoryOf[exam] ?? "" });
        expect(reachAllows(forExam, { groupIds: gs })).toBe(authorize(p, perm, scope, NOW));
      }),
    );
  });
});

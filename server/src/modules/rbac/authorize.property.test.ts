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
const tags = ["t1", "t2"];
const tagsOf: Record<string, string[]> = { e1: ["t1"], e2: [], e3: ["t1", "t2"], e4: ["t2"] };
const ref = (e: string) => ({ examId: e, categoryId: categoryOf[e] ?? "", tagIds: tagsOf[e] ?? [] });

const permission = fc.constantFrom(...ALL_PERMISSIONS);
const grantArb: fc.Arbitrary<GrantScope> = fc.record({
  permissions: fc.uniqueArray(permission, { minLength: 1, maxLength: 4 }),
  allExams: fc.boolean(),
  examIds: fc.subarray(exams),
  categoryIds: fc.subarray(categories),
  tagIds: fc.subarray(tags),
  allGroups: fc.boolean(),
  groupIds: fc.subarray(groups),
  studentsWhoSubmitted: fc.boolean(),
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
/** Targets: none, a group (groups only), or a student (groups + the exams they submitted). */
const targetArb = fc.oneof(
  fc.constant({}),
  fc.constantFrom(...groups).map((g) => ({ groupIds: [g] })),
  fc
    .record({ groupIds: fc.subarray(groups), submitted: fc.subarray(exams) })
    .map(({ groupIds, submitted }) => ({ groupIds, submitted: submitted.map(ref) })),
);
const scopeArb: fc.Arbitrary<Scope> = fc
  .record({ exam: fc.option(fc.constantFrom(...exams), { nil: undefined }), target: targetArb })
  .map(({ exam, target }) => ({ ...(exam ? ref(exam) : {}), ...target }));

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
          // Dropping the whole target (groups and submitted exams) is a narrowing; dropping half isn't.
          expect(authorize(p, perm, { ...scope, groupIds: undefined, submitted: undefined }, NOW)).toBe(true);
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
      fc.property(principalArb, permission, fc.constantFrom(...exams), targetArb, (p, perm, exam, target) => {
        const forExam = reachForExam(reachOf(p, perm, NOW), { id: exam, ...ref(exam) });
        expect(reachAllows(forExam, target)).toBe(authorize(p, perm, { ...ref(exam), ...target }, NOW));
      }),
    );
  });
});

describe('tag grants and "students who submitted" grants', () => {
  const strictGrant = fc.record({
    permissions: fc.uniqueArray(permission, { minLength: 1, maxLength: 4 }),
    tagIds: fc.subarray(tags, { minLength: 1 }),
  });

  it("a tag grant covers an exam exactly when the exam carries one of its tags", () => {
    check(
      fc.property(strictGrant, fc.constantFrom(...exams), (g, exam) => {
        const p: Principal = {
          userId: "u",
          role: "INSTRUCTOR",
          grants: [
            {
              ...g,
              allExams: false,
              examIds: [],
              categoryIds: [],
              allGroups: true,
              groupIds: [],
              studentsWhoSubmitted: false,
              expiresAt: null,
            },
          ],
        };
        const carries = (tagsOf[exam] ?? []).some((t) => g.tagIds.includes(t));
        expect(authorize(p, g.permissions[0] ?? "EXAM_EDIT", ref(exam), NOW)).toBe(carries);
      }),
    );
  });

  it("a submitted-only grant never reaches a group, and reaches a student only through a covered submitted exam", () => {
    check(
      fc.property(
        strictGrant,
        fc.constantFrom(...groups),
        fc.subarray(groups),
        fc.subarray(exams),
        (g, group, gs, done) => {
          const grant: GrantScope = {
            ...g,
            allExams: false,
            examIds: [],
            categoryIds: [],
            allGroups: false,
            groupIds: [],
            studentsWhoSubmitted: true,
            expiresAt: null,
          };
          const p: Principal = { userId: "u", role: "INSTRUCTOR", grants: [grant] };
          const perm = g.permissions[0] ?? "EXAM_EDIT";
          expect(authorize(p, perm, { groupIds: [group] }, NOW)).toBe(false);
          const student = { groupIds: gs, submitted: done.map(ref) };
          const throughCovered = done.some((e) => (tagsOf[e] ?? []).some((t) => g.tagIds.includes(t)));
          expect(authorize(p, perm, student, NOW)).toBe(throughCovered);
        },
      ),
    );
  });
});

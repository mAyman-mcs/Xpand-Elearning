import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../../test/app.js";
import { makeCategory, makeExam, makeGroup, makeUser } from "../../test/factories.js";
import { ALL_PERMISSIONS, authorize, type GrantScope, type Principal } from "./authorize.js";
import { examWhere, groupWhere, reachForExam, reachOf, studentWhere } from "./scope.js";

// Cross-checks the Prisma filters against authorize() on random grant sets: whatever a list
// query returns must be exactly what authorize() would allow, row by row.
const db = testDb();
const NOW = new Date("2026-10-01T12:00:00Z");

let exams: { id: string; categoryId: string }[] = [];
let categoryIds: string[] = [];
let groupIds: string[] = [];
const students: { id: string; groupIds: string[] }[] = [];

beforeAll(async () => {
  await resetDb(db);
  const cats = [await makeCategory(db), await makeCategory(db)];
  categoryIds = cats.map((c) => c.id);
  for (const cat of cats) for (let i = 0; i < 3; i++) exams.push(await makeExam(db, cat));
  exams = exams.map((e) => ({ id: e.id, categoryId: e.categoryId }));
  const groups = [await makeGroup(db), await makeGroup(db), await makeGroup(db)];
  groupIds = groups.map((g) => g.id);
  // Every combination of group memberships, including none and several.
  const combos: number[][] = [[], [0], [1], [2], [0, 1], [1, 2], [0, 1, 2]];
  for (const combo of combos) {
    const user = await makeUser(db, { groups: combo.map((i) => groups[i]!) });
    students.push({ id: user.id, groupIds: combo.map((i) => groupIds[i]!) });
  }
  await makeUser(db, { role: "INSTRUCTOR" }); // staff never appear in student lists
});
afterAll(() => db.$disconnect());

const grantArb = (): fc.Arbitrary<GrantScope> =>
  fc.record({
    permissions: fc.uniqueArray(fc.constantFrom(...ALL_PERMISSIONS), { minLength: 1, maxLength: 3 }),
    allExams: fc.boolean(),
    examIds: fc.subarray(exams.map((e) => e.id)),
    categoryIds: fc.subarray(categoryIds),
    allGroups: fc.boolean(),
    groupIds: fc.subarray(groupIds),
    expiresAt: fc.constantFrom(null, new Date(NOW.getTime() - 1), new Date(NOW.getTime() + 1)),
  });
const principalArb = () =>
  fc.record({
    userId: fc.constant("i"),
    role: fc.constantFrom("INSTRUCTOR" as const, "SUPER_ADMIN" as const, "STUDENT" as const),
    grants: fc.array(grantArb(), { maxLength: 3 }),
  });

const sorted = (ids: string[]) => [...ids].sort();
const RUNS = { numRuns: 60 };

describe("list filters agree with authorize()", () => {
  it("examWhere returns exactly the exams the permission reaches", async () => {
    await fc.assert(
      fc.asyncProperty(principalArb(), fc.constantFrom(...ALL_PERMISSIONS), async (p: Principal, perm) => {
        const rows = await db.exam.findMany({ where: examWhere(reachOf(p, perm, NOW)), select: { id: true } });
        const expected = exams.filter((e) => authorize(p, perm, { examId: e.id, categoryId: e.categoryId }, NOW));
        expect(sorted(rows.map((r) => r.id))).toEqual(sorted(expected.map((e) => e.id)));
      }),
      RUNS,
    );
  });

  it("studentWhere returns exactly the students the permission reaches", async () => {
    await fc.assert(
      fc.asyncProperty(principalArb(), fc.constantFrom(...ALL_PERMISSIONS), async (p: Principal, perm) => {
        const rows = await db.user.findMany({ where: studentWhere(reachOf(p, perm, NOW)), select: { id: true } });
        const expected = students.filter((s) => authorize(p, perm, { groupIds: s.groupIds }, NOW));
        expect(sorted(rows.map((r) => r.id))).toEqual(sorted(expected.map((s) => s.id)));
      }),
      RUNS,
    );
  });

  it("students of one exam respect grant pairing (reachForExam)", async () => {
    await fc.assert(
      fc.asyncProperty(
        principalArb(),
        fc.constantFrom(...ALL_PERMISSIONS),
        fc.nat(),
        async (p: Principal, perm, examIndex) => {
          const exam = exams[examIndex % exams.length]!;
          const reach = reachForExam(reachOf(p, perm, NOW), exam);
          const rows = await db.user.findMany({ where: studentWhere(reach), select: { id: true } });
          const expected = students.filter((s) =>
            authorize(p, perm, { examId: exam.id, categoryId: exam.categoryId, groupIds: s.groupIds }, NOW),
          );
          expect(sorted(rows.map((r) => r.id))).toEqual(sorted(expected.map((s) => s.id)));
        },
      ),
      RUNS,
    );
  });

  it("groupWhere returns exactly the groups the permission reaches", async () => {
    await fc.assert(
      fc.asyncProperty(principalArb(), fc.constantFrom(...ALL_PERMISSIONS), async (p: Principal, perm) => {
        const rows = await db.group.findMany({ where: groupWhere(reachOf(p, perm, NOW)), select: { id: true } });
        const expected = groupIds.filter((g) => authorize(p, perm, { groupIds: [g] }, NOW));
        expect(sorted(rows.map((r) => r.id))).toEqual(sorted(expected));
      }),
      RUNS,
    );
  });
});

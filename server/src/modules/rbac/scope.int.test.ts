import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../../test/app.js";
import { makeCategory, makeExam, makeGroup, makeTag, makeUser } from "../../test/factories.js";
import { ALL_PERMISSIONS, authorize, type ExamRef, type GrantScope, type Principal, type Scope } from "./authorize.js";
import { examWhere, groupWhere, reachForExam, reachOf, studentWhere } from "./scope.js";

// Cross-checks the Prisma filters against authorize() on random grant sets: whatever a list
// query returns must be exactly what authorize() would allow, row by row. The world has tagged
// exams and students with submitted, in-progress and voided attempts, so tag grants and
// "students who submitted" grants are checked the same way.
const db = testDb();
const NOW = new Date("2026-10-01T12:00:00Z");

const exams: ExamRef[] = [];
let categoryIds: string[] = [];
let tagIds: string[] = [];
let groupIds: string[] = [];
const students: { id: string; scope: Scope }[] = [];

beforeAll(async () => {
  await resetDb(db);
  const cats = [await makeCategory(db), await makeCategory(db)];
  categoryIds = cats.map((c) => c.id);
  const tags = [await makeTag(db), await makeTag(db)];
  tagIds = tags.map((t) => t.id);
  // Exam i carries: 0 → t0, 1 → t1, 2 → none, 3 → t0+t1, 4 → t1, 5 → none.
  const tagsOf = [[0], [1], [], [0, 1], [1], []];
  let i = 0;
  for (const cat of cats)
    for (let k = 0; k < 3; k++, i++) {
      const examTags = (tagsOf[i] ?? []).map((t) => tags[t]!);
      const exam = await makeExam(db, cat, { tags: examTags });
      exams.push({ examId: exam.id, categoryId: exam.categoryId, tagIds: examTags.map((t) => t.id) });
    }
  const groups = [await makeGroup(db), await makeGroup(db), await makeGroup(db)];
  groupIds = groups.map((g) => g.id);

  // Every combination of group memberships, each with a different set of attempts.
  const combos: number[][] = [[], [0], [1], [2], [0, 1], [1, 2], [0, 1, 2], [], []];
  for (const [n, combo] of combos.entries()) {
    const user = await makeUser(db, { groups: combo.map((g) => groups[g]!) });
    const submitted: ExamRef[] = [];
    if (n % 2 === 0) {
      const exam = exams[n % exams.length]!;
      await db.attempt.create({ data: { examId: exam.examId, userId: user.id, status: "SUBMITTED" } });
      submitted.push(exam);
    }
    if (n === 3) {
      const exam = exams[4]!;
      await db.attempt.create({ data: { examId: exam.examId, userId: user.id, status: "AUTO_SUBMITTED" } });
      submitted.push(exam);
    }
    // Neither counts as submitted.
    if (n === 7)
      await db.attempt.create({ data: { examId: exams[3]!.examId, userId: user.id, status: "IN_PROGRESS" } });
    if (n === 8) await db.attempt.create({ data: { examId: exams[1]!.examId, userId: user.id, status: "VOIDED" } });
    students.push({ id: user.id, scope: { groupIds: combo.map((g) => groupIds[g]!), submitted } });
  }
  await makeUser(db, { role: "INSTRUCTOR" }); // staff never appear in student lists
});
afterAll(() => db.$disconnect());

const grantArb = (): fc.Arbitrary<GrantScope> =>
  fc
    .record({
      permissions: fc.uniqueArray(fc.constantFrom(...ALL_PERMISSIONS), { minLength: 1, maxLength: 3 }),
      allExams: fc.boolean(),
      examIds: fc.subarray(exams.map((e) => e.examId)),
      categoryIds: fc.subarray(categoryIds),
      tagIds: fc.subarray(tagIds),
      studentMode: fc.constantFrom("all" as const, "groups" as const, "submitted" as const),
      groupIds: fc.subarray(groupIds),
      expiresAt: fc.constantFrom(null, new Date(NOW.getTime() - 1), new Date(NOW.getTime() + 1)),
    })
    .map(({ studentMode, ...g }) => ({
      ...g,
      allGroups: studentMode === "all",
      studentsWhoSubmitted: studentMode === "submitted",
      groupIds: studentMode === "groups" ? g.groupIds : [],
    }));
const principalArb = () =>
  fc.record({
    userId: fc.constant("i"),
    role: fc.constantFrom("INSTRUCTOR" as const, "SUPER_ADMIN" as const, "STUDENT" as const),
    grants: fc.array(grantArb(), { maxLength: 3 }),
  });

const sorted = (ids: string[]) => [...ids].sort();
const RUNS = { numRuns: 80 };

describe("list filters agree with authorize()", () => {
  it("examWhere returns exactly the exams the permission reaches", async () => {
    await fc.assert(
      fc.asyncProperty(principalArb(), fc.constantFrom(...ALL_PERMISSIONS), async (p: Principal, perm) => {
        const rows = await db.exam.findMany({ where: examWhere(reachOf(p, perm, NOW)), select: { id: true } });
        const expected = exams.filter((e) => authorize(p, perm, e, NOW));
        expect(sorted(rows.map((r) => r.id))).toEqual(sorted(expected.map((e) => e.examId)));
      }),
      RUNS,
    );
  });

  it("studentWhere returns exactly the students the permission reaches", async () => {
    await fc.assert(
      fc.asyncProperty(principalArb(), fc.constantFrom(...ALL_PERMISSIONS), async (p: Principal, perm) => {
        const rows = await db.user.findMany({ where: studentWhere(reachOf(p, perm, NOW)), select: { id: true } });
        const expected = students.filter((s) => authorize(p, perm, s.scope, NOW));
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
          const reach = reachForExam(reachOf(p, perm, NOW), {
            id: exam.examId,
            categoryId: exam.categoryId,
            tagIds: exam.tagIds,
          });
          const rows = await db.user.findMany({ where: studentWhere(reach), select: { id: true } });
          const expected = students.filter((s) => authorize(p, perm, { ...exam, ...s.scope }, NOW));
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

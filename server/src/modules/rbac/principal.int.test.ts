import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../../test/app.js";
import { makeCategory, makeExam, makeGrant, makeGroup, makeUser } from "../../test/factories.js";
import { loadPrincipal } from "./principal.js";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("loadPrincipal", () => {
  it("loads an instructor's grants with exam and group scopes", async () => {
    const instructor = await makeUser(db, { role: "INSTRUCTOR" });
    const group = await makeGroup(db);
    const category = await makeCategory(db);
    const exam = await makeExam(db, category);
    const expiresAt = new Date("2027-01-01T00:00:00Z");
    await makeGrant(db, instructor, {
      permissions: ["RESULTS_VIEW", "PROCTOR"],
      examIds: [exam.id],
      categoryIds: [category.id],
      groupIds: [group.id],
      expiresAt,
    });

    expect(await loadPrincipal(db, instructor)).toEqual({
      userId: instructor.id,
      role: "INSTRUCTOR",
      grants: [
        {
          permissions: ["RESULTS_VIEW", "PROCTOR"],
          allExams: false,
          examIds: [exam.id],
          categoryIds: [category.id],
          tagIds: [],
          allGroups: false,
          groupIds: [group.id],
          studentsWhoSubmitted: false,
          expiresAt,
        },
      ],
    });
  });

  it("ignores grant rows on non-instructors", async () => {
    const student = await makeUser(db);
    await makeGrant(db, student, { permissions: ["RESULTS_VIEW"], allExams: true, allGroups: true });
    expect((await loadPrincipal(db, student)).grants).toEqual([]);
  });
});

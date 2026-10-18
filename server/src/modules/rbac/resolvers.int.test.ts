import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, testDb } from "../../test/app.js";
import { seedWorld, type World } from "../../test/rbac-world.js";
import { categoryScope, examScope, groupScope, studentScope, targetScope } from "./resolvers.js";

const db = testDb();
const MISSING = "99999999-9999-4999-8999-999999999999";
let w: World;

beforeAll(async () => {
  await resetDb(db);
  w = await seedWorld(db);
});
afterAll(() => db.$disconnect());

describe("scope resolvers", () => {
  it("resolve existing targets", async () => {
    expect(await examScope(db, w.e3.id)).toEqual({ examId: w.e3.id, categoryId: w.cloud.id, tagIds: [] });
    expect(await examScope(db, w.e1.id)).toEqual({
      examId: w.e1.id,
      categoryId: w.networking.id,
      tagIds: [w.tagCore.id],
    });
    expect(await categoryScope(db, w.cloud.id)).toEqual({ categoryId: w.cloud.id });
    expect(await groupScope(db, w.groupA.id)).toEqual({ groupIds: [w.groupA.id] });
    expect(await studentScope(db, w.users.student.id)).toEqual({ groupIds: [w.groupA.id], submitted: [] });
    expect(await targetScope(db, { groupId: w.groupB.id })).toEqual({ groupIds: [w.groupB.id] });
    // Student B has submitted E1 (Networking, tagged "core").
    expect(await targetScope(db, { userId: w.studentB.id })).toEqual({
      groupIds: [w.groupB.id],
      submitted: [{ examId: w.e1.id, categoryId: w.networking.id, tagIds: [w.tagCore.id] }],
    });
  });

  it("answer NOT_FOUND for missing targets (and for non-students as students)", async () => {
    // Thunks, not promises: started one at a time, so none rejects before it is awaited.
    for (const resolve of [
      () => examScope(db, MISSING),
      () => categoryScope(db, MISSING),
      () => groupScope(db, MISSING),
      () => studentScope(db, MISSING),
      () => studentScope(db, w.users.instNone.id),
    ]) {
      await expect(resolve()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("refuses a target with neither user nor group", () => {
    expect(() => targetScope(db, {})).toThrow();
  });
});

import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../../core/context.js";
import { resetDb, testDb } from "../../test/app.js";
import { getExam, setExamTags, updateExam } from "./exams.service.js";

// The routes resolve the exam's scope first (404 for unknown ids), so these service-level
// guards only matter for direct callers; they must still answer NOT_FOUND, not crash.
const db = testDb();
const MISSING = "99999999-9999-4999-8999-999999999999";
const ctx: Ctx = {
  db,
  now: new Date(),
  actor: { userId: MISSING, role: "SUPER_ADMIN", grants: [] },
  logger: pino({ level: "silent" }),
};

beforeAll(() => resetDb(db));
afterAll(() => db.$disconnect());

describe("exam service guards", () => {
  it("answer NOT_FOUND for unknown exams", async () => {
    await expect(getExam(ctx, MISSING)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateExam(ctx, MISSING, { title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setExamTags(ctx, MISSING, [])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

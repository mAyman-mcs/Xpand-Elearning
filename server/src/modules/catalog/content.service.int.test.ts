import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../../core/context.js";
import { createTestApp, resetDb } from "../../test/app.js";
import { seedWorld, type World } from "../../test/rbac-world.js";
import {
  deleteMaterial,
  deleteQuestion,
  duplicateExam,
  importQuestions,
  listQuestions,
  updateMaterial,
  updateQuestion,
} from "./content.service.js";

// Service-level checks that HTTP can't reach: the routes' scope resolvers answer 404 for missing
// records before the services run, but the services must still refuse them (a record can be deleted
// between the two), and a few branches are easier to pin down without HTTP.

const { db } = createTestApp();
let w: World;
let ctx: Ctx;
const MISSING = "00000000-0000-4000-8000-000000000000";

beforeEach(async () => {
  await resetDb(db);
  w = await seedWorld(db);
  ctx = {
    db,
    now: new Date(),
    actor: { userId: w.users.superAdmin.id, role: "SUPER_ADMIN", grants: [] },
    logger: pino({ level: "silent" }),
  };
});
afterAll(() => db.$disconnect());

describe("missing records", () => {
  it.each([
    ["listQuestions", () => listQuestions(ctx, MISSING)],
    ["updateQuestion", () => updateQuestion(ctx, MISSING, { text: "x" })],
    ["deleteQuestion", () => deleteQuestion(ctx, MISSING)],
    ["updateMaterial", () => updateMaterial(ctx, MISSING, { title: "x" })],
    ["deleteMaterial", () => deleteMaterial(ctx, MISSING)],
    ["duplicateExam", () => duplicateExam(ctx, MISSING, { code: "NEW-1" })],
  ])("%s answers NOT_FOUND", async (_name, call) => {
    await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("locked exams", () => {
  beforeEach(async () => {
    await db.attempt.create({ data: { examId: w.e3.id, userId: w.users.student.id, status: "SUBMITTED" } });
  });

  it("refuse a type change, and accept a wording change sent without options", async () => {
    await expect(updateQuestion(ctx, w.questionE3.id, { type: "MULTI_CHOICE" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const reworded = await updateQuestion(ctx, w.questionE3.id, { text: "What is 2 + 2?" });
    expect(reworded.text).toBe("What is 2 + 2?");
    expect(reworded.options.map((o) => o.text)).toEqual(["4", "5"]);
  });

  it("refuse imports, saying why", async () => {
    const res = await importQuestions(ctx, w.e3.id, { questions: [{}], dryRun: true });
    expect(res.errors[0]).toEqual({
      index: 0,
      message: "Students have already taken this exam: questions can't be added.",
    });
  });
});

it("an import entry that isn't an object is reported as a whole", async () => {
  const res = await importQuestions(ctx, w.e2.id, { questions: ["just text"], dryRun: true });
  expect(res.errors).toEqual([{ index: 1, message: expect.stringMatching(/^question: /) as unknown }]);
});

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { authRoutes, sessionLoader } from "../modules/auth/routes.js";
import { createTestApp, resetDb } from "../test/app.js";
import { makeCategory, makeGrant, makeUser, type TestUser } from "../test/factories.js";
import { loginAs } from "../test/http.js";
import { createErrorHandler } from "./errors.js";
import { access, ApiRouter, created } from "./route.js";

// A throwaway app exercising every access policy kind against a real database.
const { db, deps } = createTestApp();
const api = new ApiRouter(deps);
const EXAM_IN_SCOPE = "11111111-1111-4111-8111-111111111111";
const EXAM_VISIBLE = "22222222-2222-4222-8222-222222222222";
const EXAM_HIDDEN = "33333333-3333-4333-8333-333333333333";

api.get("/public", { access: access.public(), handler: () => ({ ok: true }) });
api.get("/authed", { access: access.authenticated(), handler: () => ({ ok: true }) });
api.get("/admins", { access: access.roles("SUPER_ADMIN"), handler: () => ({ ok: true }) });
api.post("/exams/:examId/schedule", {
  params: z.object({ examId: z.uuid() }),
  body: z.object({ minutes: z.number().int().positive() }),
  access: access.permission("EXAM_SCHEDULE"),
  scope: (_ctx, { params }) => ({ examId: params.examId }),
  handler: (_ctx, { params, body }) => created({ examId: params.examId, minutes: body.minutes }),
});

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(sessionLoader(deps));
app.use("/api/auth", authRoutes(deps).router);
app.use("/t", api.router);
app.use(createErrorHandler(deps.logger));

let admin: TestUser, student: TestUser, instructor: TestUser, pending: TestUser;

beforeAll(async () => {
  await resetDb(db);
  admin = await makeUser(db, { role: "SUPER_ADMIN" });
  student = await makeUser(db);
  instructor = await makeUser(db, { role: "INSTRUCTOR" });
  pending = await makeUser(db, { mustChangePassword: true });
  const category = await makeCategory(db);
  for (const id of [EXAM_IN_SCOPE, EXAM_VISIBLE, EXAM_HIDDEN]) {
    await db.exam.create({
      data: { id, code: id.slice(0, 4), title: "T", durationMinutes: 30, categoryId: category.id },
    });
  }
  await makeGrant(db, instructor, { permissions: ["EXAM_SCHEDULE"], examIds: [EXAM_IN_SCOPE], allGroups: true });
  await makeGrant(db, instructor, { permissions: ["RESULTS_VIEW"], examIds: [EXAM_VISIBLE], allGroups: true });
});
afterAll(() => db.$disconnect());

const schedule = (agent: request.Agent | ReturnType<typeof request>, examId: string, body: object = { minutes: 30 }) =>
  agent.post(`/t/exams/${examId}/schedule`).send(body);

describe("ApiRouter access enforcement", () => {
  it("public routes need no session", async () => {
    expect((await request(app).get("/t/public")).status).toBe(200);
  });

  it("authenticated routes reject anonymous callers", async () => {
    expect((await request(app).get("/t/authed")).body).toEqual({ error: "UNAUTHENTICATED" });
  });

  it("blocks users who must change their password, except where allowed", async () => {
    const agent = await loginAs(app, pending);
    expect((await agent.get("/t/authed")).body).toEqual({ error: "PASSWORD_CHANGE_REQUIRED" });
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  it("role routes admit only listed roles", async () => {
    expect((await (await loginAs(app, admin)).get("/t/admins")).status).toBe(200);
    expect((await (await loginAs(app, student)).get("/t/admins")).status).toBe(403);
  });

  it("scoped permission: allowed in scope, 403 when visible, 404 when hidden", async () => {
    const agent = await loginAs(app, instructor);
    const ok = await schedule(agent, EXAM_IN_SCOPE);
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ examId: EXAM_IN_SCOPE, minutes: 30 });
    expect((await schedule(agent, EXAM_VISIBLE)).status).toBe(403);
    expect((await schedule(agent, EXAM_HIDDEN)).status).toBe(404);
  });

  it("students get 403 (not 404) on staff routes", async () => {
    expect((await schedule(await loginAs(app, student), EXAM_IN_SCOPE)).status).toBe(403);
  });

  it("super admins pass every permission check", async () => {
    expect((await schedule(await loginAs(app, admin), EXAM_HIDDEN)).status).toBe(201);
  });

  it("validates params and body before running the handler", async () => {
    const agent = await loginAs(app, admin);
    const badParam = await schedule(agent, "not-a-uuid");
    expect(badParam.status).toBe(400);
    expect(badParam.body.error).toBe("VALIDATION_FAILED");
    const badBody = await schedule(agent, EXAM_IN_SCOPE, { minutes: -1 });
    expect(badBody.body.details[0].path).toBe("minutes");
  });
});

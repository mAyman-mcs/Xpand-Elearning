import type { Logger } from "pino";
import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Exam, Question, Option } from "../../generated/prisma/client.js";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam, makeUser } from "../../test/factories.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";
import { startSweeper, sweep } from "./sweeper.js";

const { app, db, clock } = createTestApp();
let w: World;
let exam: Exam;
let qs: (Question & { options: Option[] })[];
let student: request.Agent;

const NOW = "2026-10-18T10:00:00Z";

/** An exam open for group A from 09:00 to 12:00, with three questions (1 + 2 + 1 points). */
async function seedExam(settings: Partial<Exam> = {}) {
  const e = await makeExam(db, w.networking, { title: "Session exam" });
  await db.exam.update({ where: { id: e.id }, data: { durationMinutes: 30, ...settings } });
  const question = (position: number, type: "SINGLE_CHOICE" | "MULTI_CHOICE", points: number, correct: number[]) =>
    db.question.create({
      data: {
        examId: e.id,
        type,
        text: `Question ${position + 1}`,
        position,
        points,
        options: {
          create: [0, 1, 2].map((i) => ({ text: `Option ${i}`, isCorrect: correct.includes(i), position: i })),
        },
      },
      include: { options: { orderBy: { position: "asc" } } },
    });
  qs = [
    await question(0, "SINGLE_CHOICE", 1, [0]),
    await question(1, "MULTI_CHOICE", 2, [0, 2]),
    await question(2, "SINGLE_CHOICE", 1, [1]),
  ];
  await db.assignment.create({
    data: {
      examId: e.id,
      groupId: w.groupA.id,
      mode: "FIXED",
      opensAt: new Date("2026-10-18T09:00:00Z"),
      closesAt: new Date("2026-10-18T12:00:00Z"),
    },
  });
  return db.exam.findUniqueOrThrow({ where: { id: e.id } });
}

const correctIds = (q: Question & { options: Option[] }) => q.options.filter((o) => o.isCorrect).map((o) => o.id);
const wrongId = (q: Question & { options: Option[] }) => q.options.find((o) => !o.isCorrect)?.id ?? "";

async function start(agent = student, examId = exam.id) {
  const res = await agent.post("/api/attempts").send({ examId });
  return res;
}
const save = (agent: request.Agent, attemptId: string, questionId: string, ids: string[]) =>
  agent.put(`/api/attempts/${attemptId}/answers/${questionId}`).send({ selectedOptionIds: ids });
/** Jumps the clock as the exam page would live through it: heartbeats keep the login session alive. */
async function at(time: string) {
  clock.set(time);
  await db.session.updateMany({ data: { lastSeenAt: new Date(time) } });
}
type Row = { exam: { id: string }; status: string; result: unknown };
const examRow = async () =>
  ((await student.get("/api/student/exams")).body as Row[]).find((r) => r.exam.id === exam.id);
const event = (agent: request.Agent, attemptId: string, type: string) =>
  agent.post(`/api/attempts/${attemptId}/events`).send({ type });

beforeEach(async () => {
  clock.set(NOW);
  await resetDb(db);
  w = await seedWorld(db, new Date(NOW));
  exam = await seedExam();
  student = await loginAs(app, w.users.student);
});
afterAll(() => db.$disconnect());

describe("starting", () => {
  it("shows the pre-check brief, then starts once (201) and resumes from the same session (200)", async () => {
    const brief = await student.get(`/api/student/exams/${exam.id}`);
    expect(brief.status).toBe(200);
    expect(brief.body).toMatchObject({
      exam: { id: exam.id, questionCount: 3, durationMinutes: 30, strikeLimit: 3 },
      status: "OPEN",
      inProgressAttemptId: null,
    });

    const first = await start();
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: "IN_PROGRESS",
      questionCount: 3,
      strikes: 0,
      student: { username: "student.a" },
      startedAt: "2026-10-18T10:00:00.000Z",
      deadlineAt: "2026-10-18T10:30:00.000Z",
      serverNow: "2026-10-18T10:00:00.000Z",
      answers: {},
    });
    expect(first.body.questions).toHaveLength(3);

    const again = await start();
    expect(again.status).toBe(200);
    expect(again.body.attemptId).toBe(first.body.attemptId);
    expect((await student.get(`/api/student/exams/${exam.id}`)).body.inProgressAttemptId).toBe(first.body.attemptId);
    expect(await db.attempt.count({ where: { examId: exam.id } })).toBe(1);
  });

  it("never sends the answer key", async () => {
    const res = await start();
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/isCorrect|correct/i);
    for (const q of res.body.questions as { options: object[] }[])
      for (const o of q.options) expect(Object.keys(o).sort()).toEqual(["id", "text"]);
    expect(Object.keys(res.body.questions[0] as object).sort()).toEqual(
      ["id", "imageUrl", "index", "options", "points", "text", "type"].sort(),
    );
  });

  it("caps the deadline at the window's close (E7)", async () => {
    await at("2026-10-18T11:50:00Z");
    const res = await start();
    expect(res.body.deadlineAt).toBe("2026-10-18T12:00:00.000Z");
  });

  it("two starts at once create one attempt", async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.attemptId).toBe(b.body.attemptId);
    expect(await db.attempt.count({ where: { examId: exam.id } })).toBe(1);
  });

  it("refuses closed, unassigned, draft, empty and already-submitted exams", async () => {
    clock.set("2026-10-18T08:00:00Z");
    expect((await start()).body.error).toBe("EXAM_NOT_OPEN");
    clock.set(NOW);

    // Not assigned to group B: it doesn't exist for student B.
    const b = await loginAs(app, w.studentB);
    expect((await start(b)).status).toBe(404);
    expect((await b.get(`/api/student/exams/${exam.id}`)).status).toBe(404);

    const empty = await makeExam(db, w.networking);
    await db.assignment.create({
      data: { examId: empty.id, groupId: w.groupA.id, mode: "FIXED", opensAt: new Date(0) },
    });
    expect((await start(student, empty.id)).body).toMatchObject({ error: "EXAM_NOT_OPEN" });

    await db.exam.update({ where: { id: exam.id }, data: { status: "DRAFT" } });
    expect((await start()).status).toBe(404);
    await db.exam.update({ where: { id: exam.id }, data: { status: "PUBLISHED" } });

    const { body } = await start();
    await student.post(`/api/attempts/${body.attemptId}/submit`).send({});
    const again = await start();
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_SUBMITTED");
  });

  it("refuses staff (403) and anonymous callers (401)", async () => {
    const staff = await loginAs(app, w.users.superAdmin);
    expect((await start(staff)).status).toBe(403);
    const { default: supertest } = await import("supertest");
    expect((await supertest(app).post("/api/attempts").send({ examId: exam.id })).status).toBe(401);
  });

  it("shuffles questions and options per attempt, and keeps the order fixed", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const u = await makeUser(db, { groups: [w.groupA] });
      const res = await start(await loginAs(app, u));
      const order = (res.body.questions as { id: string; options: { id: string }[] }[])
        .map((q) => q.id + q.options.map((o) => o.id).join(""))
        .join("|");
      orders.add(order);
    }
    expect(orders.size).toBeGreaterThan(1);

    const first = await start();
    const again = await student.get(`/api/attempts/${first.body.attemptId}`);
    expect(again.body.questions).toEqual(first.body.questions);
  });
});

describe("answering and grading", () => {
  it("saves, overwrites, validates, and grades all-or-nothing (E2)", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    const [q1, q2, q3] = qs as [(typeof qs)[0], (typeof qs)[0], (typeof qs)[0]];

    expect((await save(student, id, q1.id, [wrongId(q1)])).status).toBe(200);
    expect((await save(student, id, q1.id, correctIds(q1))).status).toBe(200); // overwrite
    // Multi: only one of the two correct options is no points.
    expect((await save(student, id, q2.id, [correctIds(q2)[0] ?? ""])).status).toBe(200);
    expect((await save(student, id, q3.id, correctIds(q3))).status).toBe(200);

    // Two options on a single-choice question, foreign options, duplicates: refused.
    expect(
      (
        await save(
          student,
          id,
          q1.id,
          q1.options.slice(0, 2).map((o) => o.id),
        )
      ).status,
    ).toBe(400);
    expect((await save(student, id, q1.id, [q2.options[0]?.id ?? ""])).status).toBe(400);
    expect((await save(student, id, q2.id, [correctIds(q2)[0] ?? "", correctIds(q2)[0] ?? ""])).status).toBe(400);
    // A question that isn't in this attempt.
    expect((await save(student, id, w.questionE3.id, [])).status).toBe(404);

    const reloaded = await student.get(`/api/attempts/${id}`);
    expect(reloaded.body.answers).toEqual({
      [q1.id]: correctIds(q1),
      [q2.id]: [correctIds(q2)[0]],
      [q3.id]: correctIds(q3),
    });

    const submitted = await student.post(`/api/attempts/${id}/submit`).send({});
    expect(submitted.body).toMatchObject({ status: "SUBMITTED", submittedAt: "2026-10-18T10:00:00.000Z" });
    const row = await db.attempt.findUniqueOrThrow({ where: { id } });
    expect(row.score?.toNumber()).toBe(2);
    expect(row.maxScore?.toNumber()).toBe(4);

    // Idempotent; and nothing more is accepted.
    expect((await student.post(`/api/attempts/${id}/submit`).send({})).body.status).toBe("SUBMITTED");
    expect((await save(student, id, q1.id, [])).body.error).toBe("ATTEMPT_CLOSED");
    expect((await student.get(`/api/attempts/${id}`)).body.error).toBe("ATTEMPT_SUBMITTED");

    const audits = await db.auditLog.findMany({ where: { entityId: id }, orderBy: { id: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["attempts.started", "attempts.submitted"]);
  });

  it("shows the score only once results are released", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    const q1 = qs[0] as (typeof qs)[0];
    await save(student, id, q1.id, correctIds(q1));
    await student.post(`/api/attempts/${id}/submit`).send({});

    const before = await student.get(`/api/attempts/${id}/outcome`);
    expect(before.body).toMatchObject({ status: "SUBMITTED", examTitle: "Session exam", result: null });
    const row = await examRow();
    expect(row).toMatchObject({ status: "SUBMITTED", result: null });

    await db.exam.update({ where: { id: exam.id }, data: { resultsReleased: true } });
    expect((await student.get(`/api/attempts/${id}/outcome`)).body.result).toEqual({ score: 1, maxScore: 4 });
    expect((await examRow())?.result).toEqual({ score: 1, maxScore: 4 });
  });

  it("other students' attempts don't exist (404)", async () => {
    const { body } = await start();
    const other = await loginAs(app, await makeUser(db, { groups: [w.groupA] }));
    const id = body.attemptId as string;
    expect((await other.get(`/api/attempts/${id}`)).status).toBe(404);
    expect((await other.get(`/api/attempts/${id}/outcome`)).status).toBe(404);
    expect((await save(other, id, qs[0]?.id ?? "", [])).status).toBe(404);
    expect((await other.post(`/api/attempts/${id}/submit`).send({})).status).toBe(404);
    expect((await event(other, id, "TAB_HIDDEN")).status).toBe(404);
    expect((await other.post(`/api/attempts/${id}/heartbeat`).send({})).status).toBe(404);
    expect((await db.attempt.findUniqueOrThrow({ where: { id } })).strikes).toBe(0);
  });
});

describe("without back navigation", () => {
  it("closes earlier questions and stops sending them", async () => {
    exam = await seedExam({ allowBackNavigation: false, shuffleQuestions: false });
    const { body } = await start();
    const id = body.attemptId as string;
    const [q1, q2, q3] = qs as [(typeof qs)[0], (typeof qs)[0], (typeof qs)[0]];

    await save(student, id, q1.id, correctIds(q1));
    expect((await student.post(`/api/attempts/${id}/position`).send({ index: 1 })).body).toEqual({
      furthestIndex: 1,
    });
    expect((await save(student, id, q1.id, [])).body.error).toBe("QUESTION_CLOSED");
    expect((await student.post(`/api/attempts/${id}/position`).send({ index: 0 })).body.error).toBe("QUESTION_CLOSED");
    expect((await student.post(`/api/attempts/${id}/position`).send({ index: 9 })).status).toBe(400);

    // Answering a later question moves forward too.
    await save(student, id, q3.id, correctIds(q3));
    const view = await student.get(`/api/attempts/${id}`);
    expect(view.body.furthestIndex).toBe(2);
    expect((view.body.questions as { id: string }[]).map((q) => q.id)).toEqual([q3.id]);
    expect((await save(student, id, q2.id, correctIds(q2))).body.error).toBe("QUESTION_CLOSED");
  });

  it("with back navigation, position is a no-op", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    expect((await student.post(`/api/attempts/${id}/position`).send({ index: 2 })).body).toEqual({
      furthestIndex: 0,
    });
  });
});

describe("one device (E4/E5)", () => {
  it("refuses another login session and records a DEVICE_CHANGE strike", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    const second = await loginAs(app, w.users.student);

    const refused = await start(second);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("ATTEMPT_IN_PROGRESS_ELSEWHERE");
    expect(refused.body.questions).toBeUndefined();
    expect((await second.get(`/api/attempts/${id}`)).body.error).toBe("ATTEMPT_IN_PROGRESS_ELSEWHERE");
    expect((await save(second, id, qs[0]?.id ?? "", [])).status).toBe(409);
    expect((await second.post(`/api/attempts/${id}/submit`).send({})).status).toBe(409);

    const v = await db.violation.findMany({ where: { attemptId: id } });
    expect(v.every((x) => x.type === "DEVICE_CHANGE")).toBe(true);
    // Within 3 s they merge into one strike.
    expect((await db.attempt.findUniqueOrThrow({ where: { id } })).strikes).toBe(1);

    // The first browser goes on.
    expect((await student.get(`/api/attempts/${id}`)).status).toBe(200);
  });
});

describe("strikes (E9)", () => {
  it("merges signals within 3 s, logs blocked actions, and auto-submits at the limit", async () => {
    const { body } = await start();
    const id = body.attemptId as string;

    expect((await event(student, id, "WINDOW_BLUR")).body).toEqual({
      strikes: 1,
      strikeLimit: 3,
      action: "WARN",
      status: "IN_PROGRESS",
    });
    // The same Alt+Tab: hidden + fullscreen exit, merged.
    expect((await event(student, id, "TAB_HIDDEN")).body.action).toBe("LOGGED");
    expect((await event(student, id, "FULLSCREEN_EXIT")).body.strikes).toBe(1);
    expect((await event(student, id, "CLIPBOARD")).body).toMatchObject({ action: "LOGGED", strikes: 1 });

    clock.set("2026-10-18T10:00:05Z");
    expect((await event(student, id, "TAB_HIDDEN")).body).toMatchObject({ action: "WARN", strikes: 2 });
    clock.set("2026-10-18T10:00:10Z");
    expect((await event(student, id, "RESIZE")).body).toMatchObject({
      action: "AUTO_SUBMITTED",
      strikes: 3,
      status: "AUTO_SUBMITTED",
    });
    expect((await event(student, id, "RESIZE")).body).toMatchObject({ action: "ENDED", strikes: 3 });

    const row = await db.attempt.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "AUTO_SUBMITTED", submitReason: "strike limit" });
    expect(row.score?.toNumber()).toBe(0);
    const violations = await db.violation.findMany({ where: { attemptId: id }, orderBy: { occurredAt: "asc" } });
    expect(violations).toHaveLength(6);
    expect(violations.filter((v) => v.countsAsStrike)).toHaveLength(3);
  });

  it("concurrent signals never lose a strike", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    await db.exam.update({ where: { id: exam.id }, data: { strikeLimit: 50 } });
    const results = [];
    for (let i = 0; i < 5; i++) {
      clock.set(new Date(Date.parse(NOW) + i * 4000));
      results.push(event(student, id, "TAB_HIDDEN"), event(student, id, "WINDOW_BLUR"));
      await Promise.all(results.splice(0));
    }
    expect((await db.attempt.findUniqueOrThrow({ where: { id } })).strikes).toBe(5);
  });

  it("rejects unknown and server-only event types", async () => {
    const { body } = await start();
    expect((await event(student, body.attemptId, "DEVICE_CHANGE")).status).toBe(400);
    expect((await event(student, body.attemptId, "NOPE")).status).toBe(400);
  });

  it("drops events beyond 60 a minute without storing them", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    await db.exam.update({ where: { id: exam.id }, data: { strikeLimit: 500 } });
    for (let i = 0; i < 62; i++) await event(student, id, "CONTEXT_MENU");
    expect(await db.violation.count({ where: { attemptId: id } })).toBe(60);
  });
});

describe("the clock (E6–E8)", () => {
  it("accepts saves in the 5 s grace, then auto-submits lazily", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    const q1 = qs[0] as (typeof qs)[0];

    await at("2026-10-18T10:30:04Z");
    expect((await save(student, id, q1.id, correctIds(q1))).status).toBe(200);
    await at("2026-10-18T10:30:06Z");
    expect((await save(student, id, q1.id, [])).body.error).toBe("ATTEMPT_CLOSED");

    const row = await db.attempt.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "AUTO_SUBMITTED", submitReason: "time" });
    expect(row.score?.toNumber()).toBe(1);
    expect((await student.get(`/api/attempts/${id}/outcome`)).body.status).toBe("AUTO_SUBMITTED");
  });

  it("the heartbeat answers whether to go on", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    await at("2026-10-18T10:10:00Z");
    expect((await student.post(`/api/attempts/${id}/heartbeat`).send({})).body).toEqual({
      active: true,
      status: "IN_PROGRESS",
      deadlineAt: "2026-10-18T10:30:00.000Z",
      serverNow: "2026-10-18T10:10:00.000Z",
      strikes: 0,
    });
    await at("2026-10-18T10:31:00Z");
    expect((await student.post(`/api/attempts/${id}/heartbeat`).send({})).body).toMatchObject({
      active: false,
      status: "AUTO_SUBMITTED",
    });
  });

  it("an expired attempt is replaced by a fresh start only if attempts remain", async () => {
    const { body } = await start();
    await at("2026-10-18T10:40:00Z");
    const again = await start();
    expect(again.body.error).toBe("ALREADY_SUBMITTED");
    expect((await db.attempt.findUniqueOrThrow({ where: { id: body.attemptId } })).status).toBe("AUTO_SUBMITTED");
  });
});

describe("the sweeper", () => {
  it("finalizes overdue attempts once and logs a heartbeat gap once", async () => {
    const { body } = await start();
    const id = body.attemptId as string;

    expect(await sweep(db, new Date("2026-10-18T10:00:20Z"))).toEqual({ finalized: 0, disconnected: 0 });
    expect(await sweep(db, new Date("2026-10-18T10:01:00Z"))).toEqual({ finalized: 0, disconnected: 1 });
    expect(await sweep(db, new Date("2026-10-18T10:02:00Z"))).toEqual({ finalized: 0, disconnected: 0 });
    const gap = await db.violation.findMany({ where: { attemptId: id } });
    expect(gap).toMatchObject([{ type: "HEARTBEAT_MISSED", countsAsStrike: false }]);

    const [a, b] = await Promise.all([
      sweep(db, new Date("2026-10-18T10:31:00Z")),
      sweep(db, new Date("2026-10-18T10:31:00Z")),
    ]);
    expect(a.finalized + b.finalized).toBe(1);
    const row = await db.attempt.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "AUTO_SUBMITTED", submitReason: "time" });
    expect(await db.auditLog.count({ where: { entityId: id, action: "attempts.submitted" } })).toBe(1);
  });
});

describe("submit races", () => {
  it("submit and the deadline sweep finalize exactly once", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    await at("2026-10-18T10:30:03Z");
    await Promise.all([
      student.post(`/api/attempts/${id}/submit`).send({}),
      sweep(db, new Date("2026-10-18T10:31:00Z")),
    ]);
    expect(await db.auditLog.count({ where: { entityId: id, action: "attempts.submitted" } })).toBe(1);
  });
});

describe("edges", () => {
  it("an unknown exam is not found; moving after the end is refused", async () => {
    expect((await start(student, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const { body } = await start();
    await student.post(`/api/attempts/${body.attemptId}/submit`).send({});
    expect((await student.post(`/api/attempts/${body.attemptId}/position`).send({ index: 1 })).body.error).toBe(
      "ATTEMPT_CLOSED",
    );
  });

  it("stores the browser's clock with the server's", async () => {
    const { body } = await start();
    await student
      .post(`/api/attempts/${body.attemptId}/events`)
      .send({ type: "TAB_HIDDEN", clientTime: "2026-10-18T09:59:58Z", detail: { hiddenMs: 1200 } });
    const [v] = await db.violation.findMany({ where: { attemptId: body.attemptId } });
    expect(v).toMatchObject({ clientTime: new Date("2026-10-18T09:59:58Z"), detail: { hiddenMs: 1200 } });
    expect(v?.occurredAt).toEqual(new Date(NOW));
  });

  it("the event flood guard resets after a minute", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    await db.exam.update({ where: { id: exam.id }, data: { strikeLimit: 500 } });
    for (let i = 0; i < 61; i++) await event(student, id, "CONTEXT_MENU");
    await at("2026-10-18T10:01:01Z");
    await event(student, id, "CONTEXT_MENU");
    expect(await db.violation.count({ where: { attemptId: id } })).toBe(61);
  });

  it("racing strikes past the limit: one auto-submit, the rest see the end", async () => {
    await db.exam.update({ where: { id: exam.id }, data: { strikeLimit: 1 } });
    const { body } = await start();
    const id = body.attemptId as string;
    const results = await Promise.all(Array.from({ length: 6 }, () => event(student, id, "RESIZE")));
    const actions = results.map((r) => r.body.action as string);
    expect(actions.filter((a) => a === "AUTO_SUBMITTED")).toHaveLength(1);
    expect(actions.filter((a) => a !== "AUTO_SUBMITTED").every((a) => a === "ENDED")).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: id, action: "attempts.submitted" } })).toBe(1);
  });

  it("saves racing a submit never land after grading", async () => {
    const { body } = await start();
    const id = body.attemptId as string;
    const q1 = qs[0] as (typeof qs)[0];
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, () => save(student, id, q1.id, correctIds(q1))),
      student.post(`/api/attempts/${id}/submit`).send({}),
      ...Array.from({ length: 4 }, () => save(student, id, q1.id, correctIds(q1))),
    ]);
    expect(responses.every((r) => r.status === 200 || r.body.error === "ATTEMPT_CLOSED")).toBe(true);
    const row = await db.attempt.findUniqueOrThrow({ where: { id } });
    const saved = await db.attemptAnswer.count({ where: { attemptId: id } });
    // The grade matches exactly what was stored when the attempt closed.
    expect(row.score?.toNumber()).toBe(saved);
  });
});

describe("startSweeper", () => {
  it("sweeps on a timer until stopped, and logs failures instead of throwing", async () => {
    const { body } = await start();
    const logs: string[] = [];
    const logger = {
      info: (_o: unknown, msg: string) => logs.push(msg),
      error: (_o: unknown, msg: string) => logs.push(msg),
    } as unknown as Logger;
    const stop = startSweeper(db, logger, () => new Date("2026-10-18T10:31:00Z"), 20);
    await expect.poll(() => logs, { timeout: 5000 }).toContain("exam session sweep");
    stop();
    expect((await db.attempt.findUniqueOrThrow({ where: { id: body.attemptId } })).status).toBe("AUTO_SUBMITTED");

    const broken = { $transaction: () => Promise.reject(new Error("down")) } as unknown as typeof db;
    const stopBroken = startSweeper(broken, logger, () => new Date(), 20);
    await expect.poll(() => logs, { timeout: 5000 }).toContain("exam session sweep failed");
    stopBroken();
  });
});

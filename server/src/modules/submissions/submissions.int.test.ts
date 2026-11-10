// "Give another attempt", the submissions list, the read-only preview and the staff dashboard.
import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Exam } from "../../generated/prisma/client.js";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam, makeGrant, makeUser, type TestUser } from "../../test/factories.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db, clock } = createTestApp();
let w: World;
let admin: request.Agent;
let student: request.Agent;

const NOW = "2026-11-09T10:00:00Z";
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(new Date(NOW).getTime() + offsetMs);

/** A published one-question exam assigned to group A (window open now unless `closesAt` is given). */
async function seedExam(opts: { scoringMode?: Exam["scoringMode"]; closesAt?: Date; title?: string } = {}) {
  const exam = await makeExam(db, w.networking, { title: opts.title ?? "Retake exam" });
  await db.exam.update({
    where: { id: exam.id },
    data: { shuffleQuestions: false, shuffleOptions: false, scoringMode: opts.scoringMode ?? "AUTO" },
  });
  const question = await db.question.create({
    data: {
      examId: exam.id,
      type: "SINGLE_CHOICE",
      text: "Which port does HTTPS use?",
      position: 0,
      points: 1,
      options: {
        create: [
          { text: "443", isCorrect: true, position: 0 },
          { text: "80", isCorrect: false, position: 1 },
        ],
      },
    },
    include: { options: { orderBy: { position: "asc" } } },
  });
  await db.assignment.create({
    data: {
      examId: exam.id,
      groupId: w.groupA.id,
      mode: "FIXED",
      opensAt: at(-24 * HOUR),
      closesAt: opts.closesAt ?? null,
    },
  });
  return { exam, question };
}

/** Student A takes the exam now and answers `optionIndex`. */
async function take(examId: string, optionIndex = 0, agent = student) {
  const start = await agent.post("/api/attempts").send({ examId });
  expect(start.status).toBe(201);
  const attemptId = start.body.attemptId as string;
  const q = start.body.questions[0] as { id: string; options: { id: string }[] };
  await agent
    .put(`/api/attempts/${attemptId}/answers/${q.id}`)
    .send({ selectedOptionIds: [q.options[optionIndex]?.id] });
  expect((await agent.post(`/api/attempts/${attemptId}/submit`).send({})).status).toBe(200);
  return attemptId;
}

const giveAnother = (agent: request.Agent, body: object) =>
  agent.post("/api/assignments/extra-attempts").send({ userId: w.users.student.id, reason: "Was ill", ...body });

const statusOf = async (examId: string) =>
  ((await student.get(`/api/student/exams/${examId}`)).body as { status: string }).status;

beforeEach(async () => {
  clock.set(NOW);
  await resetDb(db);
  w = await seedWorld(db, new Date(NOW));
  admin = await loginAs(app, w.users.superAdmin);
  student = await loginAs(app, w.users.student);
});
afterAll(() => db.$disconnect());

// ─────────────────────────────── Give another attempt ───────────────────────────────

describe("give another attempt", () => {
  it("lets a student who used every attempt take the exam again, keeping the old attempt", async () => {
    const { exam } = await seedExam();
    const first = await take(exam.id, 1);
    expect(await statusOf(exam.id)).toBe("SUBMITTED");

    const res = await giveAnother(admin, { examId: exam.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ student: { id: w.users.student.id }, status: "OPEN" });
    expect(await statusOf(exam.id)).toBe("OPEN");

    const second = await take(exam.id, 0);
    const attempts = await db.attempt.findMany({ where: { examId: exam.id }, orderBy: { attemptNo: "asc" } });
    expect(attempts.map((a) => [a.id, a.attemptNo, a.score?.toNumber()])).toEqual([
      [first, 1, 0],
      [second, 2, 1],
    ]);
    // One extra attempt is one attempt: afterwards the exam is done again.
    expect(await statusOf(exam.id)).toBe("SUBMITTED");

    const log = await db.auditLog.findFirst({ where: { action: "attempts.extra_given" } });
    expect(log).toMatchObject({ actorId: w.users.superAdmin.id, entityType: "ExtraAttempt" });
    expect(log?.detail).toMatchObject({ examId: exam.id, userId: w.users.student.id, reason: "Was ill" });
  });

  it("after the window closed: the attempt alone leaves it closed; openUntil opens it until then", async () => {
    const { exam } = await seedExam({ closesAt: at(HOUR) });
    await take(exam.id);
    clock.set(at(2 * HOUR).toISOString());
    admin = await loginAs(app, w.users.superAdmin);
    student = await loginAs(app, w.users.student);

    const closed = await giveAnother(admin, { examId: exam.id });
    expect(closed.body).toMatchObject({ status: "CLOSED", reason: "The scheduled window has passed." });

    await take(exam.id).catch(() => undefined); // refused: closed
    expect(await db.attempt.count({ where: { examId: exam.id } })).toBe(1);

    // The extra attempt is still unused, so the second request is refused; opening is separate.
    expect((await giveAnother(admin, { examId: exam.id })).status).toBe(409);
    await db.extraAttempt.deleteMany();
    const until = at(26 * HOUR).toISOString();
    const opened = await giveAnother(admin, { examId: exam.id, openUntil: until });
    expect(opened.body).toMatchObject({ status: "OPEN", source: "user-override", closesAt: until });
    const override = await db.accessOverride.findFirstOrThrow({
      where: { examId: exam.id, userId: w.users.student.id },
    });
    expect(override).toMatchObject({ action: "OPEN", reason: "Another attempt: Was ill" });
    expect((await student.post("/api/attempts").send({ examId: exam.id })).status).toBe(201);
  });

  it("refuses when the student isn't done, or the exam can't be taken again", async () => {
    const { exam } = await seedExam();
    const refused = async (examId: string, message: RegExp) => {
      const res = await giveAnother(admin, { examId });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(message);
    };
    await refused(exam.id, /still has an attempt left/);

    expect((await student.post("/api/attempts").send({ examId: exam.id })).status).toBe(201);
    await refused(exam.id, /taking this exam right now/);

    const external = await makeExam(db, w.networking, { isExternal: true });
    await db.assignment.create({ data: { examId: external.id, groupId: w.groupA.id, mode: "MANUAL" } });
    await refused(external.id, /outside the platform/);

    const archived = await makeExam(db, w.networking, { status: "ARCHIVED" });
    await db.assignment.create({ data: { examId: archived.id, groupId: w.groupA.id, mode: "MANUAL" } });
    await refused(archived.id, /archived/);

    await refused(w.e2.id, /isn't assigned/);
    expect(await db.extraAttempt.count()).toBe(0);
  });

  it("checks the input: a reason, and an end in the future", async () => {
    const { exam } = await seedExam();
    await take(exam.id);
    expect((await giveAnother(admin, { examId: exam.id, reason: " " })).status).toBe(400);
    const past = await giveAnother(admin, { examId: exam.id, openUntil: at(-HOUR).toISOString() });
    expect(past.status).toBe(400);
    expect(past.body.details).toEqual([{ path: "openUntil", message: "The end must be in the future." }]);
  });

  it("needs EXAM_SCHEDULE as well to open the exam", async () => {
    const { exam } = await seedExam();
    await take(exam.id);
    const assigner = await makeUser(db, { role: "INSTRUCTOR", username: "inst.assign" });
    await makeGrant(db, assigner, { permissions: ["EXAM_ASSIGN"], examIds: [exam.id], groupIds: [w.groupA.id] });
    const agent = await loginAs(app, assigner);

    const open = await giveAnother(agent, { examId: exam.id, openUntil: at(HOUR).toISOString() });
    expect(open.status).toBe(403);
    expect(open.body.message).toMatch(/not open the exam/);
    expect((await giveAnother(agent, { examId: exam.id })).status).toBe(201);
  });

  it("gives one attempt when the button is pressed twice at once", async () => {
    const { exam } = await seedExam();
    await take(exam.id);
    const results = await Promise.all([
      giveAnother(admin, { examId: exam.id }),
      giveAnother(admin, { examId: exam.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.extraAttempt.count()).toBe(1);
  });
});

// ─────────────────────────────── Submissions ───────────────────────────────

type Row = { attemptId: string; isLatest: boolean; student: { id: string }; exam: { id: string } };
const list = async (agent: request.Agent, query: Record<string, string> = {}) => {
  const res = await agent.get("/api/submissions").query(query);
  expect(res.status).toBe(200);
  return res.body as { items: Row[]; nextCursor: string | null };
};
const ids = (rows: Row[]) => rows.map((r) => r.attemptId);

describe("submissions list", () => {
  it("lists submitted exams newest first, with filters and paging; never one in progress", async () => {
    const auto = await seedExam({ title: "Auto exam" });
    const manual = await seedExam({ title: "Manual exam", scoringMode: "MANUAL_APPROVAL" });
    const a = await take(auto.exam.id);
    clock.set(at(60_000).toISOString());
    const m = await take(manual.exam.id);
    const inProgress = await seedExam({ title: "Other" });
    await student.post("/api/attempts").send({ examId: inProgress.exam.id });

    expect(ids((await list(admin)).items)).toEqual([m, a, w.attemptE1B.id]);
    expect(ids((await list(admin, { show: "awaiting-grading" })).items)).toEqual([m]);
    expect(ids((await list(admin, { examId: auto.exam.id })).items)).toEqual([a]);
    expect(ids((await list(admin, { q: "manual" })).items)).toEqual([m]);
    expect(ids((await list(admin, { q: "student.b" })).items)).toEqual([w.attemptE1B.id]);

    const first = await list(admin, { limit: "2" });
    expect(ids(first.items)).toEqual([m, a]);
    expect(ids((await list(admin, { limit: "2", cursor: first.nextCursor ?? "" })).items)).toEqual([w.attemptE1B.id]);
  });

  it("marks only the latest attempt, so older ones can't get another attempt", async () => {
    const { exam } = await seedExam();
    const first = await take(exam.id);
    await giveAnother(admin, { examId: exam.id });
    clock.set(at(60_000).toISOString());
    const second = await take(exam.id);
    const rows = (await list(admin, { examId: exam.id })).items;
    expect(rows.map((r) => [r.attemptId, r.isLatest])).toEqual([
      [second, true],
      [first, false],
    ]);
  });

  it("shows each instructor only what one grant covers (exam and student together)", async () => {
    const { exam } = await seedExam();
    await db.assignment.create({ data: { examId: exam.id, groupId: w.groupB.id, mode: "MANUAL" } });
    const own = await take(exam.id);
    // instSplit: RESULTS_VIEW on E1 × group A and E2 × group B. Student B's E1 attempt is the trap.
    const e1A = await db.attempt.create({ data: { examId: w.e1.id, userId: w.users.student.id, status: "SUBMITTED" } });
    const e2B = await db.attempt.create({ data: { examId: w.e2.id, userId: w.studentB.id, status: "AUTO_SUBMITTED" } });
    await db.attempt.create({ data: { examId: w.e2.id, userId: w.users.student.id, status: "SUBMITTED" } });

    const as = async (u: TestUser) => ids((await list(await loginAs(app, u))).items).sort();
    expect(await as(w.users.instSplit)).toEqual([e1A.id, e2B.id].sort());
    expect(await as(w.users.instExamA)).toEqual([e1A.id]);
    // "Students who submitted" a core exam (E1): both students now have.
    expect(await as(w.users.instTag)).toEqual([e1A.id, w.attemptE1B.id].sort());
    expect(await as(w.users.instCategory)).toEqual([]); // EXAM_EDIT/ASSIGN/SCHEDULE only: no results
    expect(await as(w.users.instNone)).toEqual([]);
    expect(await as(w.users.instExpired)).toEqual([]);
    expect((await list(admin)).items.map((r) => r.attemptId)).toContain(own);
  });
});

// ─────────────────────────────── Preview ───────────────────────────────

describe("preview of a submitted exam", () => {
  it("shows an auto-scored attempt read only: answers, key and points", async () => {
    const { exam, question } = await seedExam();
    const attemptId = await take(exam.id, 1);
    const res = await admin.get(`/api/submissions/${attemptId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      attemptId,
      exam: { id: exam.id, scoringMode: "AUTO" },
      student: { id: w.users.student.id },
      score: 0,
      maxScore: 1,
      approvalProblems: [],
      canGrade: false,
      canGiveAnotherAttempt: true,
    });
    expect(res.body.nextUngradedId).toBeUndefined();
    expect(res.body.questions[0].options).toEqual([
      expect.objectContaining({ id: question.options[0]?.id, isCorrect: true, selected: false }),
      expect.objectContaining({ id: question.options[1]?.id, isCorrect: false, selected: true }),
    ]);
  });

  it("offers grading on needs-approval exams, and another attempt only on the latest one", async () => {
    const { exam } = await seedExam({ scoringMode: "MANUAL_APPROVAL" });
    const first = await take(exam.id);
    expect((await admin.get(`/api/submissions/${first}`)).body).toMatchObject({
      canGrade: true,
      canGiveAnotherAttempt: true,
    });

    await giveAnother(admin, { examId: exam.id });
    const second = await student.post("/api/attempts").send({ examId: exam.id });
    expect((await admin.get(`/api/submissions/${second.body.attemptId as string}`)).status).toBe(409);
    expect((await admin.get(`/api/submissions/${first}`)).body).toMatchObject({ canGiveAnotherAttempt: false });
  });

  it("says what the instructor may do with it", async () => {
    const { exam } = await seedExam({ scoringMode: "MANUAL_APPROVAL" });
    const attemptId = await take(exam.id);
    const viewer = await makeUser(db, { role: "INSTRUCTOR", username: "inst.viewer" });
    await makeGrant(db, viewer, { permissions: ["RESULTS_VIEW"], examIds: [exam.id], groupIds: [w.groupA.id] });
    const res = await (await loginAs(app, viewer)).get(`/api/submissions/${attemptId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ canGrade: false, canGiveAnotherAttempt: false });
  });
});

// ─────────────────────────────── Dashboard ───────────────────────────────

describe("staff dashboard", () => {
  it("counts what the caller's grants reach, and zeros for an instructor without any", async () => {
    const { exam } = await seedExam({ scoringMode: "MANUAL_APPROVAL" });
    await take(exam.id);
    await db.attempt.update({ where: { id: w.attemptE1B.id }, data: { submittedAt: at(-30 * 24 * HOUR) } });

    const mine = await admin.get("/api/me/dashboard");
    expect(mine.status).toBe(200);
    // E1, E2, E3 and this exam; students A and B; two submissions, one waiting, one this week.
    expect(mine.body).toEqual({ exams: 4, students: 2, submissions: { total: 2, awaitingGrading: 1, lastWeek: 1 } });

    const none = await (await loginAs(app, w.users.instNone)).get("/api/me/dashboard");
    expect(none.body).toEqual({ exams: 0, students: 0, submissions: { total: 0, awaitingGrading: 0, lastWeek: 0 } });

    const split = await (await loginAs(app, w.users.instSplit)).get("/api/me/dashboard");
    expect(split.body).toEqual({ exams: 2, students: 2, submissions: { total: 0, awaitingGrading: 0, lastWeek: 0 } });
  });
});

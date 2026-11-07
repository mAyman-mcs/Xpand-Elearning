// Exam types, essay answers and manual grading, end to end (docs/EXAM_TYPES_PLAN.md).
import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Exam, Option, Question } from "../../generated/prisma/client.js";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam, makeGrant, makeUser } from "../../test/factories.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db, clock } = createTestApp();
let w: World;
let admin: request.Agent;
let student: request.Agent;

const NOW = "2026-11-07T10:00:00Z";

type Q = Question & { options: Option[] };

/**
 * A published exam open for group A, with one single-choice question (1 point) and, for MCQ_ESSAY,
 * two essays (5 points each). Shuffling is off so the delivery order is the position order.
 */
async function seedExam(type: Exam["type"], scoringMode: Exam["scoringMode"]) {
  const e = await makeExam(db, w.networking, { title: `${type} exam` });
  await db.exam.update({
    where: { id: e.id },
    data: { type, scoringMode, shuffleQuestions: false, shuffleOptions: false },
  });
  const choice = await db.question.create({
    data: {
      examId: e.id,
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
  const essays: Q[] = [];
  if (type === "MCQ_ESSAY")
    for (const position of [1, 2])
      essays.push(
        await db.question.create({
          data: {
            examId: e.id,
            type: "ESSAY",
            text: `Explain topic ${position}.`,
            guidance: `Model answer ${position}`,
            position,
            points: 5,
          },
          include: { options: true },
        }),
      );
  await db.assignment.create({
    data: { examId: e.id, groupId: w.groupA.id, mode: "FIXED", opensAt: new Date("2026-11-07T09:00:00Z") },
  });
  return { exam: e, choice, essays };
}

const correct = (q: Q) => q.options.find((o) => o.isCorrect)?.id ?? "";

async function takeExam(examId: string, answers: (attemptId: string) => Promise<unknown>) {
  const start = await student.post("/api/attempts").send({ examId });
  expect(start.status).toBe(201);
  const attemptId = start.body.attemptId as string;
  await answers(attemptId);
  expect((await student.post(`/api/attempts/${attemptId}/submit`).send({})).status).toBe(200);
  return { attemptId, view: start.body };
}

const saveText = (attemptId: string, questionId: string, text: string) =>
  student.put(`/api/attempts/${attemptId}/answers/${questionId}`).send({ text });
const saveChoice = (attemptId: string, questionId: string, ids: string[]) =>
  student.put(`/api/attempts/${attemptId}/answers/${questionId}`).send({ selectedOptionIds: ids });

beforeEach(async () => {
  clock.set(NOW);
  await resetDb(db);
  w = await seedWorld(db, new Date(NOW));
  admin = await loginAs(app, w.users.superAdmin);
  student = await loginAs(app, w.users.student);
});
afterAll(() => db.$disconnect());

// ─────────────────────────────── Settings ───────────────────────────────

describe("exam type and scoring mode", () => {
  const create = (body: object) =>
    admin.post("/api/catalog/exams").send({ title: "T", durationMinutes: 30, categoryId: w.cloud.id, ...body });

  it("defaults to MCQ, auto scored; an essay exam defaults to needing approval", async () => {
    expect((await create({ code: "T-1" })).body).toMatchObject({ type: "MCQ", scoringMode: "AUTO" });
    expect((await create({ code: "T-2", type: "MCQ_ESSAY" })).body).toMatchObject({
      type: "MCQ_ESSAY",
      scoringMode: "MANUAL_APPROVAL",
    });
    expect((await create({ code: "T-3", scoringMode: "MANUAL_APPROVAL" })).body).toMatchObject({
      type: "MCQ",
      scoringMode: "MANUAL_APPROVAL",
    });
  });

  it("refuses an essay exam that is auto scored, in the API and in the database", async () => {
    const res = await create({ code: "T-4", type: "MCQ_ESSAY", scoringMode: "AUTO" });
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual([{ path: "scoringMode", message: expect.stringMatching(/can't be auto scored/) }]);

    const e = await makeExam(db, w.cloud);
    await expect(db.exam.update({ where: { id: e.id }, data: { type: "MCQ_ESSAY" } })).rejects.toThrow(
      /Exam_essay_needs_approval/,
    );
  });

  it("external exams ignore type and scoring", async () => {
    const res = await create({ code: "T-5", isExternal: true, type: "MCQ_ESSAY" });
    expect(res.body).toMatchObject({ type: "MCQ", scoringMode: "AUTO" });
  });

  it("switching to essays moves to needing approval; switching back needs the essays removed (T4)", async () => {
    const id = (await create({ code: "T-6" })).body.id as string;
    const patch = (body: object) => admin.patch(`/api/catalog/exams/${id}`).send(body);

    expect((await patch({ type: "MCQ_ESSAY" })).body).toMatchObject({ scoringMode: "MANUAL_APPROVAL" });
    expect((await patch({ scoringMode: "AUTO" })).status).toBe(400);

    const essay = await admin
      .post(`/api/catalog/exams/${id}/questions`)
      .send({ type: "ESSAY", text: "Why?", points: 5 });
    expect(essay.status).toBe(201);
    const back = await patch({ type: "MCQ", scoringMode: "AUTO" });
    expect(back.status).toBe(409);
    expect(back.body.message).toMatch(/Remove the 1 essay question first/);

    expect((await admin.delete(`/api/catalog/questions/${essay.body.id}`).send({})).status).toBe(204);
    expect((await patch({ type: "MCQ", scoringMode: "AUTO" })).body).toMatchObject({
      type: "MCQ",
      scoringMode: "AUTO",
    });

    const audit = await db.auditLog.findFirst({ where: { action: "catalog.exam_updated" }, orderBy: { id: "desc" } });
    expect(audit?.detail).toMatchObject({ changes: { type: { from: "MCQ_ESSAY", to: "MCQ" } } });
  });

  it("locks type and scoring once students have taken the exam (T3)", async () => {
    const { exam } = await seedExam("MCQ", "AUTO");
    await db.attempt.create({ data: { examId: exam.id, userId: w.studentB.id, status: "SUBMITTED" } });
    const res = await admin.patch(`/api/catalog/exams/${exam.id}`).send({ scoringMode: "MANUAL_APPROVAL" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/type and scoring can't change/);
    // Other settings still change; resending the same values is not a change.
    expect(
      (await admin.patch(`/api/catalog/exams/${exam.id}`).send({ title: "New", scoringMode: "AUTO" })).status,
    ).toBe(200);
  });
});

// ─────────────────────────────── Content ───────────────────────────────

describe("essay questions", () => {
  it("are refused in an MCQ exam and accepted, with guidance, in an essay exam", async () => {
    const mcq = await makeExam(db, w.cloud, { status: "DRAFT" });
    const refused = await admin.post(`/api/catalog/exams/${mcq.id}/questions`).send({ type: "ESSAY", text: "Why?" });
    expect(refused.status).toBe(400);
    expect(refused.body.details[0].path).toBe("type");

    const { exam } = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const ok = await admin
      .post(`/api/catalog/exams/${exam.id}/questions`)
      .send({ type: "ESSAY", text: "Why?", points: 3, guidance: "Mention TLS" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ type: "ESSAY", options: [], guidance: "Mention TLS" });

    // Options are refused on essays; guidance is dropped on choice questions.
    expect(
      (
        await admin
          .post(`/api/catalog/exams/${exam.id}/questions`)
          .send({ type: "ESSAY", text: "x", options: [{ text: "a", isCorrect: true }] })
      ).status,
    ).toBe(400);
    const choice = await admin.post(`/api/catalog/exams/${exam.id}/questions`).send({
      type: "TRUE_FALSE",
      text: "TLS?",
      guidance: "ignored",
      options: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
    });
    expect(choice.body.guidance).toBeNull();
  });

  it("import checks the exam type; duplicating keeps type, scoring and guidance", async () => {
    const mcq = await makeExam(db, w.cloud, { status: "DRAFT" });
    const imported = await admin
      .post(`/api/catalog/exams/${mcq.id}/questions/import`)
      .send({ questions: [{ type: "ESSAY", text: "Why?" }], dryRun: true });
    expect(imported.body.errors).toEqual([{ index: 1, message: expect.stringMatching(/exam type/) }]);

    const { exam } = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const copy = await admin.post(`/api/catalog/exams/${exam.id}/duplicate`).send({ code: "COPY-1" });
    expect(copy.status).toBe(201);
    const copied = await db.exam.findUniqueOrThrow({ where: { id: copy.body.id }, include: { questions: true } });
    expect(copied).toMatchObject({ type: "MCQ_ESSAY", scoringMode: "MANUAL_APPROVAL" });
    expect(copied.questions.map((q) => q.guidance ?? "").sort()).toEqual(["", "Model answer 1", "Model answer 2"]);
  });

  it("an essay exam can't be published without an essay (T2)", async () => {
    const draft = await makeExam(db, w.cloud, { status: "DRAFT" });
    await db.exam.update({ where: { id: draft.id }, data: { type: "MCQ_ESSAY", scoringMode: "MANUAL_APPROVAL" } });
    await admin.post(`/api/catalog/exams/${draft.id}/questions`).send({
      type: "TRUE_FALSE",
      text: "TLS?",
      options: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
    });
    const res = await admin.patch(`/api/catalog/exams/${draft.id}`).send({ status: "PUBLISHED" });
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual([expect.stringMatching(/Add at least one essay question/)]);
  });
});

// ─────────────────────────────── The exam session ───────────────────────────────

describe("taking an essay exam", () => {
  it("saves essay text, keeps it on resume, and never sends the guidance", async () => {
    const { exam, choice, essays } = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const start = await student.post("/api/attempts").send({ examId: exam.id });
    const attemptId = start.body.attemptId as string;
    expect(JSON.stringify(start.body)).not.toMatch(/guidance|Model answer|isCorrect|autoPoints/);
    expect(start.body.questions[1]).toMatchObject({ type: "ESSAY", options: [] });

    expect((await saveText(attemptId, essays[0]!.id, "TLS encrypts.")).status).toBe(200);
    expect((await saveText(attemptId, essays[0]!.id, "TLS encrypts traffic.")).status).toBe(200);
    expect((await saveChoice(attemptId, choice.id, [correct(choice)])).status).toBe(200);

    const resumed = await student.get(`/api/attempts/${attemptId}`);
    expect(resumed.body.essays).toEqual({ [essays[0]!.id]: "TLS encrypts traffic." });
    expect(resumed.body.answers).toEqual({ [choice.id]: [correct(choice)] });
  });

  it("refuses the wrong answer shape and over-long essays", async () => {
    const { exam, choice, essays } = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const attemptId = (await student.post("/api/attempts").send({ examId: exam.id })).body.attemptId as string;
    expect((await saveChoice(attemptId, essays[0]!.id, [])).status).toBe(400);
    expect((await saveText(attemptId, choice.id, "443")).status).toBe(400);
    expect((await saveText(attemptId, essays[0]!.id, "x".repeat(10_001))).status).toBe(400);
    expect((await saveText(attemptId, essays[0]!.id, "x".repeat(10_000))).status).toBe(200);
    expect(
      (
        await student
          .put(`/api/attempts/${attemptId}/answers/${essays[0]!.id}`)
          .send({ text: "a", selectedOptionIds: [] })
      ).status,
    ).toBe(400);
  });

  it("on submit: choice points are computed, the score waits for approval", async () => {
    const { exam, choice, essays } = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const { attemptId } = await takeExam(exam.id, async (id) => {
      await saveChoice(id, choice.id, [correct(choice)]);
      await saveText(id, essays[0]!.id, "An answer");
    });
    const attempt = await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: true } });
    expect(attempt.score).toBeNull();
    expect(attempt.maxScore?.toNumber()).toBe(11);
    expect(attempt.reviewStatus).toBe("PENDING");
    expect(attempt.answers.find((a) => a.questionId === choice.id)?.autoPoints?.toNumber()).toBe(1);
    expect(attempt.answers.find((a) => a.questionId === essays[0]!.id)?.autoPoints).toBeNull();

    await db.exam.update({ where: { id: exam.id }, data: { resultsReleased: true } });
    expect((await student.get(`/api/attempts/${attemptId}/outcome`)).body).toMatchObject({
      awaitingGrading: true,
      result: null,
    });
    const row = ((await student.get("/api/student/exams")).body as { exam: { id: string }; result: unknown }[]).find(
      (r) => r.exam.id === exam.id,
    );
    expect(row).toMatchObject({ exam: { scoringMode: "MANUAL_APPROVAL" }, progress: "ANSWERED", result: null });
  });

  it("auto-scored exams are unchanged: scored on submit, with points per answer", async () => {
    const { exam, choice } = await seedExam("MCQ", "AUTO");
    const { attemptId } = await takeExam(exam.id, (id) => saveChoice(id, choice.id, [correct(choice)]));
    const attempt = await db.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { answers: true } });
    expect(attempt.score?.toNumber()).toBe(1);
    expect(attempt.answers[0]?.autoPoints?.toNumber()).toBe(1);
    expect((await student.get(`/api/attempts/${attemptId}/outcome`)).body.awaitingGrading).toBe(false);
  });
});

// ─────────────────────────────── Grading ───────────────────────────────

describe("grading", () => {
  async function submitted() {
    const seeded = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const { choice, essays } = seeded;
    const { attemptId } = await takeExam(seeded.exam.id, async (id) => {
      await saveChoice(id, choice.id, [correct(choice)]);
      await saveText(id, essays[0]!.id, "<script>alert(1)</script> TLS");
      // essays[1] is left unanswered.
    });
    return { ...seeded, attemptId };
  }
  const grading = (attemptId: string) => admin.get(`/api/grading/attempts/${attemptId}`);
  const saveGrades = (attemptId: string, version: number, grades: object[]) =>
    admin.put(`/api/grading/attempts/${attemptId}/grades`).send({ version, grades });

  it("queue → grade → approve → released score → reopen", async () => {
    const { exam, choice, essays, attemptId } = await submitted();

    const queue = await admin.get(`/api/grading/exams/${exam.id}`);
    expect(queue.status).toBe(200);
    expect(queue.body).toMatchObject({
      items: [{ attemptId, reviewStatus: "PENDING", essays: { answered: 1, graded: 0 }, score: null, maxScore: 11 }],
      counts: { pending: 1, underReview: 0, reviewed: 0 },
      nextCursor: null,
    });

    const view = await grading(attemptId);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      reviewStatus: "PENDING",
      gradingVersion: 0,
      score: null,
      student: { username: "student.a" },
      exam: { scoringMode: "MANUAL_APPROVAL" },
      approvalProblems: ["Give points for question 2."],
      nextUngradedId: null,
    });
    expect(view.body.questions).toMatchObject([
      {
        id: choice.id,
        autoPoints: 1,
        answered: true,
        options: [{ isCorrect: true, selected: true }, { selected: false }],
      },
      { id: essays[0]!.id, answerText: "<script>alert(1)</script> TLS", guidance: "Model answer 1", answered: true },
      { id: essays[1]!.id, answerText: null, answered: false },
    ]);

    // Approval before every answered essay has points is refused.
    expect((await admin.post(`/api/grading/attempts/${attemptId}/approve`).send({ version: 0 })).status).toBe(409);

    const saved = await saveGrades(attemptId, 0, [{ questionId: essays[0]!.id, points: 3.5, feedback: "Good start" }]);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ reviewStatus: "UNDER_REVIEW", gradingVersion: 1, approvalProblems: [] });
    expect(saved.body.questions[1]).toMatchObject({
      awardedPoints: 3.5,
      feedback: "Good start",
      gradedBy: { username: "super" },
    });

    // Release before approval: the student still sees no score.
    await db.exam.update({ where: { id: exam.id }, data: { resultsReleased: true } });
    expect((await student.get(`/api/attempts/${attemptId}/outcome`)).body.result).toBeNull();

    const approved = await admin.post(`/api/grading/attempts/${attemptId}/approve`).send({ version: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ reviewStatus: "REVIEWED", score: 4.5, reviewedBy: { username: "super" } });
    expect((await student.get(`/api/attempts/${attemptId}/outcome`)).body).toMatchObject({
      awaitingGrading: false,
      result: { score: 4.5, maxScore: 11 },
    });

    // Approved: grading changes need a reopen first.
    expect((await saveGrades(attemptId, 2, [{ questionId: essays[0]!.id, points: 5 }])).status).toBe(409);

    expect((await admin.post(`/api/grading/attempts/${attemptId}/reopen`).send({ reason: "" })).status).toBe(400);
    const reopened = await admin.post(`/api/grading/attempts/${attemptId}/reopen`).send({ reason: "Recheck essay" });
    expect(reopened.body).toMatchObject({ reviewStatus: "UNDER_REVIEW", score: null, reviewedBy: null });
    expect((await student.get(`/api/attempts/${attemptId}/outcome`)).body).toMatchObject({
      awaitingGrading: true,
      result: null,
    });

    const actions = (await db.auditLog.findMany({ where: { entityId: attemptId }, orderBy: { id: "asc" } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual([
      "attempts.started",
      "attempts.submitted",
      "attempts.graded",
      "attempts.approved",
      "attempts.reopened",
    ]);
  });

  it("refuses a stale version (two graders)", async () => {
    const { essays, attemptId } = await submitted();
    expect((await saveGrades(attemptId, 0, [{ questionId: essays[0]!.id, points: 2 }])).status).toBe(200);
    const stale = await saveGrades(attemptId, 0, [{ questionId: essays[0]!.id, points: 4 }]);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("GRADING_CONFLICT");
    expect((await admin.post(`/api/grading/attempts/${attemptId}/approve`).send({ version: 0 })).body.error).toBe(
      "GRADING_CONFLICT",
    );
  });

  it("checks points: range, half steps, unanswered essays, overrides with a reason", async () => {
    const { choice, essays, attemptId } = await submitted();
    const one = (grade: object) => saveGrades(attemptId, 0, [grade]);
    expect((await one({ questionId: essays[0]!.id, points: 6 })).status).toBe(400);
    expect((await one({ questionId: essays[0]!.id, points: 2.25 })).status).toBe(400);
    expect((await one({ questionId: essays[1]!.id, points: 1 })).body.message).toMatch(/didn't answer/);
    expect((await one({ questionId: w.questionE3.id, points: 0 })).body.message).toMatch(/isn't part of the attempt/);
    expect((await one({ questionId: choice.id, points: 0 })).body.message).toMatch(/needs a reason/);

    const overridden = await one({ questionId: choice.id, points: 0, reason: "Key was wrong" });
    expect(overridden.status).toBe(200);
    expect(overridden.body.questions[0]).toMatchObject({
      autoPoints: 1,
      awardedPoints: 0,
      overrideReason: "Key was wrong",
    });

    // Back to the automatic points: the override is removed.
    const restored = await saveGrades(attemptId, 1, [{ questionId: choice.id, points: 1 }]);
    expect(restored.body.questions[0]).toMatchObject({ awardedPoints: null, overrideReason: null });
  });

  it("an MCQ exam that needs approval: approving unchanged gives the automatic score", async () => {
    const { exam, choice } = await seedExam("MCQ", "MANUAL_APPROVAL");
    const { attemptId } = await takeExam(exam.id, (id) => saveChoice(id, choice.id, [correct(choice)]));
    expect((await db.attempt.findUniqueOrThrow({ where: { id: attemptId } })).score).toBeNull();
    const approved = await admin.post(`/api/grading/attempts/${attemptId}/approve`).send({ version: 0 });
    expect(approved.body).toMatchObject({ reviewStatus: "REVIEWED", score: 1, approvalProblems: [] });
  });

  it("refuses in-progress attempts and auto-scored exams", async () => {
    const { exam } = await seedExam("MCQ_ESSAY", "MANUAL_APPROVAL");
    const attemptId = (await student.post("/api/attempts").send({ examId: exam.id })).body.attemptId as string;
    expect((await grading(attemptId)).body.message).toMatch(/still taking/);

    const auto = await seedExam("MCQ", "AUTO");
    expect((await admin.get(`/api/grading/exams/${auto.exam.id}`)).status).toBe(409);
  });

  it("instructors grade only students in their grant; counts are scoped too", async () => {
    const { exam, attemptId } = await submitted();
    // A second finished attempt by student B (group B).
    const other = await db.attempt.create({
      data: { examId: exam.id, userId: w.studentB.id, status: "SUBMITTED", submittedAt: new Date(NOW) },
    });
    const grader = await makeUser(db, { role: "INSTRUCTOR", username: "grader.b" });
    await makeGrant(db, grader, { permissions: ["ATTEMPT_REVIEW"], examIds: [exam.id], groupIds: [w.groupB.id] });
    const agent = await loginAs(app, grader);

    const queue = await agent.get(`/api/grading/exams/${exam.id}`);
    const items = queue.body.items as { attemptId: string }[];
    expect(items.map((r) => r.attemptId)).toEqual([other.id]);
    expect(queue.body.counts).toEqual({ pending: 1, underReview: 0, reviewed: 0 });
    expect((await agent.get(`/api/grading/attempts/${attemptId}`)).status).toBe(404);
    expect((await agent.get(`/api/grading/attempts/${other.id}`)).status).toBe(200);
    // The super admin's "next ungraded" walks through both.
    expect((await grading(attemptId)).body.nextUngradedId).toBe(other.id);
  });

  it("filters the queue by review status", async () => {
    const { exam, attemptId } = await submitted();
    const list = (q: string) => admin.get(`/api/grading/exams/${exam.id}?reviewStatus=${q}`);
    expect((await list("REVIEWED")).body.items).toEqual([]);
    expect((await list("NOT_REVIEWED")).body.items).toHaveLength(1);
    expect((await list("PENDING")).body.items[0].attemptId).toBe(attemptId);
  });
});

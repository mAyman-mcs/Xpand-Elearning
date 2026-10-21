import { randomInt } from "node:crypto";
import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, notFound } from "../../core/errors.js";
import { uuid } from "../../core/schemas.js";
import type { Attempt, AttemptStatus, Prisma, ViolationType } from "../../generated/prisma/client.js";
import { resolveAvailability } from "../assignments/availability.js";
import { loadExamRules, loadStudents, rulesFor } from "../assignments/inputs.js";
import {
  acceptsAnswers,
  applyEvent,
  CLIENT_EVENT_TYPES,
  deadlineFor,
  deliveryOrder,
  grade,
  isOverdue,
  validSelection,
  type EventAction,
} from "./rules.js";

// The exam session, enforced by the server (docs/NEXT_PLAN.md §3–4). The browser only displays and
// reports: the server owns the questions, the clock, the answers, the strikes and the grade.

const cryptoRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

// ─────────────────────────────── Schemas ───────────────────────────────

export const startBody = z.object({ examId: uuid });
export const answerBody = z.object({ selectedOptionIds: z.array(uuid).max(10) });
export const positionBody = z.object({ index: z.number().int().min(0).max(500) });
export const eventBody = z.object({
  type: z.enum(CLIENT_EVENT_TYPES),
  detail: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
  clientTime: z.iso.datetime({ offset: true }).optional(),
});
export const answerParams = z.object({ id: uuid, questionId: uuid });

// ─────────────────────────────── Loading ───────────────────────────────

const examFields = {
  id: true,
  code: true,
  title: true,
  status: true,
  isExternal: true,
  maxAttempts: true,
  durationMinutes: true,
  strikeLimit: true,
  requireFullscreen: true,
  allowBackNavigation: true,
  shuffleQuestions: true,
  shuffleOptions: true,
} as const;

/** The student's availability for one exam, by the same resolver as their exam list. */
async function availabilityFor(db: DbClient, userId: string, examId: string, now: Date) {
  const [students, exam] = await Promise.all([
    loadStudents(db, [userId]),
    db.exam.findUnique({ where: { id: examId }, select: examFields }),
  ]);
  const student = students.get(userId);
  if (!student || !exam) throw notFound("Exam not found.");
  const rules = await loadExamRules(db, [examId], [student]);
  const availability = resolveAvailability({ exam, student, now, ...rulesFor(rules, examId, userId) });
  // Drafts and unassigned exams don't exist for students.
  if (availability.status === "NOT_ASSIGNED" || exam.status === "DRAFT") throw notFound("Exam not found.");
  return { exam, availability };
}

/** The caller's own attempt; anyone else's is "not found". */
async function loadOwn(ctx: Ctx, attemptId: string): Promise<Attempt> {
  const attempt = await ctx.db.attempt.findFirst({ where: { id: attemptId, userId: actorOf(ctx).userId } });
  if (!attempt) throw notFound("Attempt not found.");
  return attempt;
}

const order = (a: Pick<Attempt, "questionOrder">) => (a.questionOrder ?? []) as string[];
const optionOrder = (a: Pick<Attempt, "optionOrder">) => (a.optionOrder ?? {}) as Record<string, string[]>;

// ─────────────────────────────── Finalizing ───────────────────────────────

/**
 * Ends an in-progress attempt and grades it, in the caller's transaction. Compare-and-set: of
 * several racing finishers (submit, deadline, strike limit) exactly one wins; the rest see false.
 */
export async function finalize(
  tx: Prisma.TransactionClient,
  attemptId: string,
  status: Exclude<AttemptStatus, "IN_PROGRESS" | "VOIDED">,
  reason: string,
  now: Date,
  actorId: string | null,
): Promise<boolean> {
  const done = await tx.attempt.updateMany({
    where: { id: attemptId, status: "IN_PROGRESS" },
    data: { status, submittedAt: now, submitReason: reason },
  });
  if (done.count === 0) return false;

  const attempt = await tx.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  const ids = order(attempt);
  const questions = await tx.question.findMany({
    where: { id: { in: ids } },
    include: { options: { where: { isCorrect: true } } },
  });
  const answers = await tx.attemptAnswer.findMany({ where: { attemptId } });
  const result = grade(
    questions.map((q) => ({ id: q.id, points: q.points.toNumber(), correctOptionIds: q.options.map((o) => o.id) })),
    new Map(answers.map((a) => [a.questionId, a.selectedOptionIds])),
  );
  await tx.attempt.update({ where: { id: attemptId }, data: { score: result.score, maxScore: result.maxScore } });
  await audit(tx, {
    action: "attempts.submitted",
    actorId,
    entityType: "Attempt",
    entityId: attemptId,
    detail: {
      examId: attempt.examId,
      userId: attempt.userId,
      status,
      reason,
      score: result.score,
      maxScore: result.maxScore,
    },
  });
  return true;
}

/** Lazy deadline: any request touching an overdue attempt finalizes it first (the sweeper does the rest). */
async function finalizeIfOverdue(db: DbClient, attempt: Attempt, now: Date): Promise<Attempt> {
  if (attempt.status !== "IN_PROGRESS" || !attempt.deadlineAt || !isOverdue(attempt.deadlineAt, now)) return attempt;
  await inTransaction(db, (tx) => finalize(tx, attempt.id, "AUTO_SUBMITTED", "time", now, null));
  return db.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
}

const ended = (a: Attempt) =>
  new AppError("ATTEMPT_SUBMITTED", {
    message: "This attempt has ended.",
    details: { status: a.status, submittedAt: a.submittedAt, submitReason: a.submitReason },
  });

// ─────────────────────────────── Violations and the one-device rule ───────────────────────────────

interface EventResult {
  strikes: number;
  strikeLimit: number;
  action: EventAction | "ENDED";
  status: AttemptStatus;
}

/** Records a signal, applies the strike policy, and auto-submits at the limit — atomically. */
async function recordViolation(
  ctx: Ctx,
  attemptId: string,
  type: ViolationType,
  detail: Prisma.InputJsonObject | undefined,
  clientTime: Date | null,
): Promise<EventResult> {
  return inTransaction(ctx.db, async (tx) => {
    // Row lock: concurrent events are applied one after the other (strikes are never lost).
    const rows = await tx.$queryRaw<{ strikes: number; strikeMergedUntil: Date | null; examId: string }[]>`
      SELECT "strikes", "strikeMergedUntil", "examId" FROM "Attempt"
      WHERE "id" = ${attemptId}::uuid AND "status" = 'IN_PROGRESS' FOR UPDATE`;
    const row = rows[0];
    if (!row) {
      const a = await tx.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { exam: { select: { strikeLimit: true } } },
      });
      return { strikes: a.strikes, strikeLimit: a.exam.strikeLimit, action: "ENDED", status: a.status };
    }
    const exam = await tx.exam.findUniqueOrThrow({ where: { id: row.examId }, select: { strikeLimit: true } });
    const r = applyEvent(
      { strikes: row.strikes, strikeMergedUntil: row.strikeMergedUntil, strikeLimit: exam.strikeLimit },
      type,
      ctx.now,
    );
    await tx.violation.create({
      data: { attemptId, type, countsAsStrike: r.countsAsStrike, detail, clientTime, ip: ctx.ip, occurredAt: ctx.now },
    });
    await tx.attempt.update({
      where: { id: attemptId },
      data: { strikes: r.strikes, strikeMergedUntil: r.strikeMergedUntil },
    });
    if (r.action === "AUTO_SUBMITTED") await finalize(tx, attemptId, "AUTO_SUBMITTED", "strike limit", ctx.now, null);
    return {
      strikes: r.strikes,
      strikeLimit: exam.strikeLimit,
      action: r.action,
      status: r.action === "AUTO_SUBMITTED" ? "AUTO_SUBMITTED" : "IN_PROGRESS",
    };
  });
}

/**
 * One device (E4/E5): only the login session that started the attempt may continue it. Any other
 * session is refused, gets nothing, and the attempt records a DEVICE_CHANGE strike. No "allow resume".
 */
async function guardSession(ctx: Ctx, attempt: Attempt, sessionId: string): Promise<void> {
  if (attempt.status !== "IN_PROGRESS" || attempt.sessionId === sessionId) return;
  await recordViolation(ctx, attempt.id, "DEVICE_CHANGE", { reason: "request from another session" }, null);
  throw new AppError("ATTEMPT_IN_PROGRESS_ELSEWHERE", {
    message: "This exam is in progress on another device or browser.",
  });
}

// ─────────────────────────────── What the student receives ───────────────────────────────

/**
 * The attempt as the student sees it. Built field by field (never by spreading rows) so the answer
 * key can't leak: no isCorrect, no other students, no questions outside this attempt.
 */
async function studentView(ctx: Ctx, attempt: Attempt) {
  const ids = order(attempt);
  const options = optionOrder(attempt);
  const [exam, questions, answers, user] = await Promise.all([
    ctx.db.exam.findUniqueOrThrow({ where: { id: attempt.examId }, select: examFields }),
    ctx.db.question.findMany({ where: { id: { in: ids } }, include: { options: true } }),
    ctx.db.attemptAnswer.findMany({ where: { attemptId: attempt.id } }),
    ctx.db.user.findUniqueOrThrow({ where: { id: attempt.userId }, select: { fullName: true, username: true } }),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  // Without back navigation, questions before the furthest one are closed: not even sent.
  const first = exam.allowBackNavigation ? 0 : attempt.furthestIndex;
  return {
    attemptId: attempt.id,
    status: attempt.status,
    exam: {
      id: exam.id,
      code: exam.code,
      title: exam.title,
      allowBackNavigation: exam.allowBackNavigation,
      requireFullscreen: exam.requireFullscreen,
      strikeLimit: exam.strikeLimit,
    },
    student: user,
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    serverNow: ctx.now,
    strikes: attempt.strikes,
    furthestIndex: attempt.furthestIndex,
    questionCount: ids.length,
    questions: ids.flatMap((id, index) => {
      const q = byId.get(id);
      if (!q || index < first) return [];
      const optionText = new Map(q.options.map((o) => [o.id, o.text]));
      return [
        {
          index,
          id: q.id,
          type: q.type,
          text: q.text,
          imageUrl: q.imageUrl,
          points: q.points.toNumber(),
          options: (options[q.id] ?? []).map((oid) => ({ id: oid, text: optionText.get(oid) ?? "" })),
        },
      ];
    }),
    answers: Object.fromEntries(answers.map((a) => [a.questionId, a.selectedOptionIds])),
  };
}
export type StudentAttemptView = Awaited<ReturnType<typeof studentView>>;

// ─────────────────────────────── Student API ───────────────────────────────

/** The pre-check page: what the exam is, its rules, whether it can be started now. */
export async function examBrief(ctx: Ctx, examId: string) {
  const userId = actorOf(ctx).userId;
  const { exam, availability } = await availabilityFor(ctx.db, userId, examId, ctx.now);
  const [questionCount, materials, inProgress] = await Promise.all([
    ctx.db.question.count({ where: { examId } }),
    ctx.db.material.findMany({ where: { examId }, select: { title: true, url: true }, orderBy: { position: "asc" } }),
    ctx.db.attempt.findFirst({ where: { examId, userId, status: "IN_PROGRESS" }, select: { id: true } }),
  ]);
  return {
    exam: {
      id: exam.id,
      code: exam.code,
      title: exam.title,
      durationMinutes: exam.durationMinutes,
      questionCount,
      strikeLimit: exam.strikeLimit,
      requireFullscreen: exam.requireFullscreen,
      allowBackNavigation: exam.allowBackNavigation,
      isExternal: exam.isExternal,
      materials,
    },
    status: availability.status,
    progress: availability.progress,
    opensAt: availability.opensAt,
    closesAt: availability.closesAt,
    reason: availability.reason,
    inProgressAttemptId: inProgress?.id ?? null,
  };
}

/**
 * Starts (or, from the same browser session, continues) an attempt. Refused unless the exam is open
 * for this student now. Questions and options are shuffled once and fixed on the attempt.
 */
export async function startAttempt(
  ctx: Ctx,
  examId: string,
  sessionId: string,
): Promise<{ created: boolean; view: StudentAttemptView }> {
  const userId = actorOf(ctx).userId;
  const resume = async (attempt: Attempt) => {
    await guardSession(ctx, attempt, sessionId);
    return { created: false, view: await studentView(ctx, attempt) };
  };

  const existing = await ctx.db.attempt.findFirst({ where: { examId, userId, status: "IN_PROGRESS" } });
  if (existing) {
    const current = await finalizeIfOverdue(ctx.db, existing, ctx.now);
    if (current.status === "IN_PROGRESS") return resume(current);
  }

  const { exam, availability } = await availabilityFor(ctx.db, userId, examId, ctx.now);
  if (availability.status === "SUBMITTED")
    throw new AppError("ALREADY_SUBMITTED", { message: "You have already submitted this exam." });
  if (availability.status !== "OPEN" || exam.isExternal)
    throw new AppError("EXAM_NOT_OPEN", { message: availability.reason });

  const questions = await ctx.db.question.findMany({
    where: { examId },
    include: { options: { orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });
  if (!questions.length) throw new AppError("EXAM_NOT_OPEN", { message: "This exam has no questions yet." });

  const { questionOrder, optionOrder: options } = deliveryOrder(questions, exam, cryptoRandom);
  const deadlineAt = deadlineFor(ctx.now, exam.durationMinutes, 0, availability.closesAt);
  try {
    const attempt = await inTransaction(ctx.db, async (tx) => {
      const attemptNo = (await tx.attempt.count({ where: { examId, userId } })) + 1;
      const created = await tx.attempt.create({
        data: {
          examId,
          userId,
          attemptNo,
          startedAt: ctx.now,
          deadlineAt,
          questionOrder,
          optionOrder: options,
          sessionId,
          lastHeartbeatAt: ctx.now,
        },
      });
      await audit(tx, {
        action: "attempts.started",
        actorId: userId,
        entityType: "Attempt",
        entityId: created.id,
        detail: { examId, attemptNo, deadlineAt: deadlineAt.toISOString() },
        ip: ctx.ip,
      });
      return created;
    });
    return { created: true, view: await studentView(ctx, attempt) };
  } catch (err) {
    // Two starts at once (double click, two tabs): the database lets one attempt through.
    if (!isUniqueViolation(err)) throw err;
    const winner = await ctx.db.attempt.findFirst({ where: { examId, userId, status: "IN_PROGRESS" } });
    if (!winner) throw err;
    return resume(winner);
  }
}

/** Resumes after a reload (same session only). An ended attempt is never shown again. */
export async function getAttempt(ctx: Ctx, attemptId: string, sessionId: string) {
  const attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  if (attempt.status !== "IN_PROGRESS") throw ended(attempt);
  await guardSession(ctx, attempt, sessionId);
  return studentView(ctx, attempt);
}

/** The status of an attempt without its questions: the "Submitted" page, after the attempt has ended. */
export async function attemptOutcome(ctx: Ctx, attemptId: string) {
  const attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  const exam = await ctx.db.exam.findUniqueOrThrow({
    where: { id: attempt.examId },
    select: { title: true, resultsReleased: true },
  });
  const released = exam.resultsReleased && attempt.status !== "IN_PROGRESS" && attempt.status !== "VOIDED";
  return {
    attemptId: attempt.id,
    examTitle: exam.title,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    submitReason: attempt.submitReason,
    result:
      released && attempt.score && attempt.maxScore
        ? { score: attempt.score.toNumber(), maxScore: attempt.maxScore.toNumber() }
        : null,
  };
}

/** Saves one answer (idempotent). Refused once the attempt has ended or past the grace period. */
export async function saveAnswer(
  ctx: Ctx,
  attemptId: string,
  questionId: string,
  sessionId: string,
  selected: string[],
) {
  const attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  if (attempt.status !== "IN_PROGRESS") throw new AppError("ATTEMPT_CLOSED", { message: "This attempt has ended." });
  await guardSession(ctx, attempt, sessionId);

  const index = order(attempt).indexOf(questionId);
  if (index < 0) throw notFound("Question not found.");
  const exam = await ctx.db.exam.findUniqueOrThrow({
    where: { id: attempt.examId },
    select: { allowBackNavigation: true },
  });
  if (!exam.allowBackNavigation && index < attempt.furthestIndex)
    throw new AppError("QUESTION_CLOSED", { message: "You can't go back to earlier questions in this exam." });
  const question = await ctx.db.question.findUniqueOrThrow({ where: { id: questionId }, select: { type: true } });
  if (!validSelection(question.type, optionOrder(attempt)[questionId] ?? [], selected))
    throw new AppError("VALIDATION_FAILED", {
      details: [{ path: "selectedOptionIds", message: "Not a valid choice." }],
    });

  return inTransaction(ctx.db, async (tx) => {
    // Shared row lock: a save and a submit can't interleave, so no answer lands after grading.
    const open = await tx.$queryRaw<{ deadlineAt: Date }[]>`
      SELECT "deadlineAt" FROM "Attempt" WHERE "id" = ${attemptId}::uuid AND "status" = 'IN_PROGRESS' FOR SHARE`;
    const row = open[0];
    if (!row || !acceptsAnswers(row.deadlineAt, ctx.now))
      throw new AppError("ATTEMPT_CLOSED", { message: "This attempt has ended." });
    await tx.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, selectedOptionIds: selected, answeredAt: ctx.now },
      update: { selectedOptionIds: selected, answeredAt: ctx.now },
    });
    if (!exam.allowBackNavigation && index > attempt.furthestIndex)
      await tx.attempt.update({ where: { id: attemptId }, data: { furthestIndex: index } });
    return { questionId, savedAt: ctx.now };
  });
}

/** Without back navigation: moves forward (e.g. skipping a question). Never backwards. */
export async function moveTo(ctx: Ctx, attemptId: string, sessionId: string, index: number) {
  const attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  if (attempt.status !== "IN_PROGRESS") throw new AppError("ATTEMPT_CLOSED", { message: "This attempt has ended." });
  await guardSession(ctx, attempt, sessionId);
  if (index >= order(attempt).length)
    throw new AppError("VALIDATION_FAILED", { details: [{ path: "index", message: "No such question." }] });
  const exam = await ctx.db.exam.findUniqueOrThrow({
    where: { id: attempt.examId },
    select: { allowBackNavigation: true },
  });
  if (exam.allowBackNavigation) return { furthestIndex: attempt.furthestIndex };
  if (index < attempt.furthestIndex)
    throw new AppError("QUESTION_CLOSED", { message: "You can't go back to earlier questions in this exam." });
  await ctx.db.attempt.updateMany({
    where: { id: attemptId, status: "IN_PROGRESS", furthestIndex: { lt: index } },
    data: { furthestIndex: index },
  });
  return { furthestIndex: index };
}

/** The student submits. Idempotent: an attempt that already ended answers with how it ended. */
export async function submitAttempt(ctx: Ctx, attemptId: string, sessionId: string) {
  let attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  if (attempt.status === "IN_PROGRESS") {
    await guardSession(ctx, attempt, sessionId);
    await inTransaction(ctx.db, (tx) =>
      finalize(tx, attemptId, "SUBMITTED", "submitted by the student", ctx.now, actorOf(ctx).userId),
    );
    attempt = await ctx.db.attempt.findUniqueOrThrow({ where: { id: attemptId } });
  }
  return { status: attempt.status, submittedAt: attempt.submittedAt };
}

// In-memory flood guard per attempt (one container; NEXT_PLAN B7): beyond 60 events a minute, the
// rest are dropped without being stored, so a misbehaving client can't flood the database.
const EVENT_LIMIT = 60;
const eventWindows = new Map<string, { start: number; count: number }>();
function allowEvent(attemptId: string, now: Date): boolean {
  const t = now.getTime();
  for (const [id, w] of eventWindows) if (t - w.start > 60_000) eventWindows.delete(id);
  const w = eventWindows.get(attemptId) ?? { start: t, count: 0 };
  w.count += 1;
  eventWindows.set(attemptId, w);
  return w.count <= EVENT_LIMIT;
}

/** A cheating signal from the browser. The server decides what it costs (strike policy). */
export async function reportEvent(
  ctx: Ctx,
  attemptId: string,
  sessionId: string,
  input: z.infer<typeof eventBody>,
): Promise<EventResult> {
  const attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  const exam = await ctx.db.exam.findUniqueOrThrow({ where: { id: attempt.examId }, select: { strikeLimit: true } });
  if (attempt.status !== "IN_PROGRESS")
    return { strikes: attempt.strikes, strikeLimit: exam.strikeLimit, action: "ENDED", status: attempt.status };
  await guardSession(ctx, attempt, sessionId);
  if (!allowEvent(attemptId, ctx.now))
    return { strikes: attempt.strikes, strikeLimit: exam.strikeLimit, action: "LOGGED", status: attempt.status };
  return recordViolation(
    ctx,
    attemptId,
    input.type,
    input.detail,
    input.clientTime ? new Date(input.clientTime) : null,
  );
}

/** Every ~10 s from the exam page: proves the student is connected; answers whether to go on. */
export async function heartbeat(ctx: Ctx, attemptId: string, sessionId: string) {
  const attempt = await finalizeIfOverdue(ctx.db, await loadOwn(ctx, attemptId), ctx.now);
  if (attempt.status !== "IN_PROGRESS")
    return {
      active: false,
      status: attempt.status,
      deadlineAt: attempt.deadlineAt,
      serverNow: ctx.now,
      strikes: attempt.strikes,
    };
  await guardSession(ctx, attempt, sessionId);
  await ctx.db.attempt.update({ where: { id: attemptId }, data: { lastHeartbeatAt: ctx.now } });
  return {
    active: true,
    status: attempt.status,
    deadlineAt: attempt.deadlineAt,
    serverNow: ctx.now,
    strikes: attempt.strikes,
  };
}

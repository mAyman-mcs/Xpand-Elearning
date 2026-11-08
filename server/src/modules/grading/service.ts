import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { pageArgs, toPage, type PageQuery } from "../../core/pagination.js";
import { nonBlank } from "../../core/schemas.js";
import type { Prisma, ReviewStatus } from "../../generated/prisma/client.js";
import { optionOrder, order, pictureUrl } from "../attempts/service.js";
import { isChoice } from "../catalog/exam-types.js";
import type { Scope } from "../rbac/authorize.js";
import { examScope, studentScope } from "../rbac/resolvers.js";
import { reachForExam, reachOf, studentWhere, SUBMITTED_STATUSES } from "../rbac/scope.js";
import { approvalProblems, finalScore, gradeProblem, type GradedAnswer, type GradedQuestion } from "./rules.js";

// Manual grading of MANUAL_APPROVAL exams (docs/EXAM_TYPES_PLAN.md §3.5). Staff only: these
// responses carry the answer key, grader guidance and other graders' names.

// ─────────────────────────────── Schemas ───────────────────────────────

export const queueQuery = z.object({
  reviewStatus: z.enum(["PENDING", "UNDER_REVIEW", "REVIEWED", "NOT_REVIEWED"]).optional(),
});

const version = z.number().int().min(0);
export const gradesBody = z.object({
  version,
  grades: z
    .array(
      z.object({
        questionId: z.uuid(),
        points: z.number().min(0).max(100),
        /** Omitted: keep the current feedback; null or "": clear it. */
        feedback: z.string().trim().max(2000).nullable().optional(),
        /** Required when changing a choice question's automatic points (T5). */
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export const approveBody = z.object({ version });
export const reopenBody = z.object({ reason: nonBlank(500) });

// ─────────────────────────────── Scope ───────────────────────────────

/** An attempt is in the scope of its exam AND its student (ATTEMPT_REVIEW on both). */
export async function attemptScope(db: DbClient, attemptId: string): Promise<Scope> {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId }, select: { examId: true, userId: true } });
  if (!attempt) throw notFound("Attempt not found.");
  const [exam, student] = await Promise.all([examScope(db, attempt.examId), studentScope(db, attempt.userId)]);
  return { ...exam, ...student };
}

/** Students of this exam the caller may grade (the same grant must cover the exam and the student). */
async function gradableStudents(ctx: Ctx, examId: string): Promise<Prisma.UserWhereInput> {
  const exam = await ctx.db.exam.findUniqueOrThrow({
    where: { id: examId },
    select: { id: true, categoryId: true, tags: { select: { tagId: true } } },
  });
  const reach = reachForExam(reachOf(actorOf(ctx), "ATTEMPT_REVIEW", ctx.now), {
    id: exam.id,
    categoryId: exam.categoryId,
    tagIds: exam.tags.map((t) => t.tagId),
  });
  return studentWhere(reach);
}

// ─────────────────────────────── Helpers ───────────────────────────────

const person = { select: { id: true, username: true, fullName: true } } as const;
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const isAnswered = (a: { text: string | null; selectedOptionIds: string[] } | undefined) =>
  !!a && (a.text === null ? a.selectedOptionIds.length > 0 : a.text.trim().length > 0);

const notManual = () => conflict("This exam is auto scored: there is nothing to grade.");

/** Only finished attempts of MANUAL_APPROVAL exams are graded. */
function assertGradable(a: { status: string; exam: { scoringMode: string } }) {
  if (a.exam.scoringMode !== "MANUAL_APPROVAL") throw notManual();
  if (a.status === "IN_PROGRESS") throw conflict("The student is still taking this exam.");
  if (a.status === "VOIDED") throw conflict("This attempt was voided.");
}

/**
 * Row lock and version check (T10): of two graders saving at once, the second one is refused and
 * must reload, so nobody overwrites changes they haven't seen.
 */
async function lockVersion(tx: Prisma.TransactionClient, attemptId: string, expected: number) {
  const rows = await tx.$queryRaw<{ gradingVersion: number }[]>`
    SELECT "gradingVersion" FROM "Attempt" WHERE "id" = ${attemptId}::uuid FOR UPDATE`;
  if (rows[0]?.gradingVersion !== expected)
    throw new AppError("GRADING_CONFLICT", {
      message: "Someone else changed this grading. Reload to see their changes.",
    });
}

async function loadAttempt(db: DbClient, attemptId: string) {
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: { select: { id: true, code: true, title: true, scoringMode: true } },
      user: person,
      answers: true,
    },
  });
  if (!attempt) throw notFound("Attempt not found.");
  const ids = order(attempt);
  const rows = await db.question.findMany({
    where: { id: { in: ids } },
    include: { options: true, case: true },
  });
  const byId = new Map(rows.map((q) => [q.id, q]));
  const questions = ids.flatMap((id) => {
    const q = byId.get(id);
    return q ? [q] : [];
  });
  return { attempt, questions, answers: new Map(attempt.answers.map((a) => [a.questionId, a])) };
}
type Loaded = Awaited<ReturnType<typeof loadAttempt>>;

function gradingInputs({ questions, answers }: Loaded) {
  const graded: GradedQuestion[] = questions.map((q) => ({ id: q.id, type: q.type, points: q.points.toNumber() }));
  const byQuestion = new Map<string, GradedAnswer>(
    questions.map((q) => {
      const a = answers.get(q.id);
      return [
        q.id,
        {
          answered: isAnswered(a),
          autoPoints: num(a?.autoPoints ?? null),
          awardedPoints: num(a?.awardedPoints ?? null),
        },
      ];
    }),
  );
  return { graded, byQuestion };
}

// ─────────────────────────────── Queue ───────────────────────────────

/** Finished attempts of one MANUAL_APPROVAL exam, for students the caller may grade. */
export async function gradingQueue(ctx: Ctx, examId: string, filter: z.infer<typeof queueQuery>, page: PageQuery) {
  const exam = await ctx.db.exam.findUniqueOrThrow({ where: { id: examId }, select: { scoringMode: true } });
  if (exam.scoringMode !== "MANUAL_APPROVAL") throw notManual();

  // Every count and row is computed after scope filtering (no leak through totals).
  const inScope: Prisma.AttemptWhereInput = {
    examId,
    status: { in: SUBMITTED_STATUSES },
    user: { is: await gradableStudents(ctx, examId) },
  };
  const status: Prisma.AttemptWhereInput =
    filter.reviewStatus === "NOT_REVIEWED"
      ? { reviewStatus: { not: "REVIEWED" } }
      : filter.reviewStatus
        ? { reviewStatus: filter.reviewStatus }
        : {};
  const [rows, grouped] = await Promise.all([
    ctx.db.attempt.findMany({
      where: { AND: [inScope, status] },
      include: {
        user: person,
        answers: { select: { questionId: true, text: true, awardedPoints: true, gradedAt: true, gradedById: true } },
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      ...pageArgs(page),
    }),
    ctx.db.attempt.groupBy({ by: ["reviewStatus"], where: inScope, _count: { _all: true } }),
  ]);
  const count = (s: ReviewStatus) => grouped.find((g) => g.reviewStatus === s)?._count._all ?? 0;

  const graderIds = [...new Set(rows.flatMap((r) => r.answers.flatMap((a) => (a.gradedById ? [a.gradedById] : []))))];
  const graders = new Map(
    (await ctx.db.user.findMany({ where: { id: { in: graderIds } }, ...person })).map((u) => [u.id, u]),
  );

  const result = toPage(rows, page, (r) => {
    const essays = r.answers.filter((a) => a.text !== null && a.text.trim().length > 0);
    const last = r.answers
      .filter((a) => a.gradedAt)
      .sort((a, b) => (b.gradedAt as Date).getTime() - (a.gradedAt as Date).getTime())[0];
    return {
      attemptId: r.id,
      attemptNo: r.attemptNo,
      student: r.user,
      status: r.status,
      submittedAt: r.submittedAt,
      reviewStatus: r.reviewStatus,
      essays: { answered: essays.length, graded: essays.filter((a) => a.awardedPoints !== null).length },
      score: num(r.score),
      maxScore: num(r.maxScore),
      lastGradedBy: (last?.gradedById && graders.get(last.gradedById)) || null,
      lastGradedAt: last?.gradedAt ?? null,
    };
  });
  return {
    ...result,
    counts: { pending: count("PENDING"), underReview: count("UNDER_REVIEW"), reviewed: count("REVIEWED") },
  };
}

// ─────────────────────────────── One attempt ───────────────────────────────

/** The attempt as the grader sees it: every question with the answer key and the student's answer. */
export async function getGrading(ctx: Ctx, attemptId: string) {
  const loaded = await loadAttempt(ctx.db, attemptId);
  const { attempt, questions, answers } = loaded;
  assertGradable(attempt);

  const options = optionOrder(attempt);
  const peopleIds = [
    ...new Set([
      ...attempt.answers.flatMap((a) => (a.gradedById ? [a.gradedById] : [])),
      ...(attempt.reviewedById ? [attempt.reviewedById] : []),
    ]),
  ];
  const [people, next] = await Promise.all([
    ctx.db.user.findMany({ where: { id: { in: peopleIds } }, ...person }),
    ctx.db.attempt.findFirst({
      where: {
        examId: attempt.examId,
        id: { not: attempt.id },
        status: { in: SUBMITTED_STATUSES },
        reviewStatus: { not: "REVIEWED" },
        user: { is: await gradableStudents(ctx, attempt.examId) },
      },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);
  const personOf = (id: string | null) => (id ? (people.find((p) => p.id === id) ?? null) : null);
  const { graded, byQuestion } = gradingInputs(loaded);

  return {
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    submitReason: attempt.submitReason,
    reviewStatus: attempt.reviewStatus,
    reviewedBy: personOf(attempt.reviewedById),
    reviewedAt: attempt.reviewedAt,
    gradingVersion: attempt.gradingVersion,
    score: num(attempt.score),
    maxScore: num(attempt.maxScore),
    exam: attempt.exam,
    student: attempt.user,
    // The cases of the delivered questions, once each, in delivery order (with hints: graders see all).
    cases: [...new Map(questions.flatMap((q) => (q.case ? [[q.case.id, q.case] as const] : []))).values()].map((c) => ({
      id: c.id,
      label: c.label,
      title: c.title,
      situation: c.situation,
      hint: c.hint,
      imageUrl: pictureUrl(c),
      imageAlt: c.imageAlt,
    })),
    questions: questions.map((q, index) => {
      const a = answers.get(q.id);
      const selected = new Set(a?.selectedOptionIds ?? []);
      const optionText = new Map(q.options.map((o) => [o.id, o]));
      return {
        index,
        id: q.id,
        type: q.type,
        caseId: q.caseId,
        text: q.text,
        imageUrl: pictureUrl(q),
        imageAlt: q.imageAlt,
        points: q.points.toNumber(),
        guidance: q.guidance,
        answerSize: q.answerSize,
        options: (options[q.id] ?? []).flatMap((oid) => {
          const o = optionText.get(oid);
          return o
            ? [
                {
                  id: o.id,
                  text: o.text,
                  detail: o.detail,
                  imageUrl: pictureUrl(o),
                  imageAlt: o.imageAlt,
                  isCorrect: o.isCorrect,
                  explanation: o.explanation,
                  selected: selected.has(o.id),
                },
              ]
            : [];
        }),
        answerText: a?.text ?? null,
        answered: isAnswered(a),
        autoPoints: num(a?.autoPoints ?? null),
        awardedPoints: num(a?.awardedPoints ?? null),
        overrideReason: a?.overrideReason ?? null,
        feedback: a?.feedback ?? null,
        gradedBy: personOf(a?.gradedById ?? null),
        gradedAt: a?.gradedAt ?? null,
      };
    }),
    approvalProblems: approvalProblems(graded, byQuestion),
    nextUngradedId: next?.id ?? null,
  };
}

/** Saves points and feedback (a draft). The attempt moves to UNDER_REVIEW; approval is separate. */
export async function saveGrades(ctx: Ctx, attemptId: string, input: z.infer<typeof gradesBody>) {
  const actorId = actorOf(ctx).userId;
  await inTransaction(ctx.db, async (tx) => {
    await lockVersion(tx, attemptId, input.version);
    const loaded = await loadAttempt(tx, attemptId);
    const { attempt, questions, answers } = loaded;
    assertGradable(attempt);
    if (attempt.reviewStatus === "REVIEWED")
      throw conflict("This attempt is approved. Reopen it to change its grading.");

    const byId = new Map(questions.map((q) => [q.id, q]));
    const problems: { path: string; message: string }[] = [];
    const changes: Prisma.InputJsonObject[] = [];
    for (const [i, g] of input.grades.entries()) {
      const q = byId.get(g.questionId);
      const a = answers.get(g.questionId);
      const problem = !q
        ? "This question isn't part of the attempt."
        : q.type === "ESSAY" && !isAnswered(a) && g.points !== 0
          ? "The student didn't answer this question: it can only get 0 points."
          : gradeProblem({ type: q.type, points: q.points.toNumber() }, g.points, num(a?.autoPoints ?? null), g.reason);
      if (problem) problems.push({ path: `grades.${i}.points`, message: problem });
    }
    if (problems.length)
      throw new AppError("VALIDATION_FAILED", { message: problems.map((p) => p.message).join(" "), details: problems });

    for (const g of input.grades) {
      const q = byId.get(g.questionId);
      /* v8 ignore next -- every grade was checked against the attempt's questions above */
      if (!q) continue;
      const a = answers.get(g.questionId);
      const auto = num(a?.autoPoints ?? null);
      // A choice question graded at its automatic points is not an override: keep no grader points.
      const override = isChoice(q.type) && g.points !== (auto ?? 0);
      const awardedPoints = isChoice(q.type) && !override ? null : g.points;
      const overrideReason = override ? (g.reason ?? null) : null;
      const feedback = g.feedback === undefined ? (a?.feedback ?? null) : g.feedback || null;
      const from = num(a?.awardedPoints ?? null);
      if (
        from === awardedPoints &&
        (a?.overrideReason ?? null) === overrideReason &&
        (a?.feedback ?? null) === feedback
      )
        continue;
      const data = { awardedPoints, overrideReason, feedback, gradedById: actorId, gradedAt: ctx.now };
      await tx.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: q.id } },
        create: { attemptId, questionId: q.id, answeredAt: ctx.now, ...data },
        update: data,
      });
      changes.push({
        questionId: q.id,
        from,
        to: awardedPoints,
        ...(overrideReason ? { reason: overrideReason } : {}),
        ...(feedback !== (a?.feedback ?? null) ? { feedbackChanged: true } : {}),
      });
    }

    await tx.attempt.update({
      where: { id: attemptId },
      data: { gradingVersion: { increment: 1 }, reviewStatus: "UNDER_REVIEW" },
    });
    await audit(tx, {
      action: "attempts.graded",
      actorId,
      entityType: "Attempt",
      entityId: attemptId,
      detail: { examId: attempt.examId, userId: attempt.userId, changes },
      ip: ctx.ip,
    });
  });
  return getGrading(ctx, attemptId);
}

/** Approves the grading: the score is computed now and the attempt is REVIEWED. */
export async function approveAttempt(ctx: Ctx, attemptId: string, input: z.infer<typeof approveBody>) {
  const actorId = actorOf(ctx).userId;
  await inTransaction(ctx.db, async (tx) => {
    await lockVersion(tx, attemptId, input.version);
    const loaded = await loadAttempt(tx, attemptId);
    const { attempt } = loaded;
    assertGradable(attempt);
    if (attempt.reviewStatus === "REVIEWED") throw conflict("This attempt is already approved.");
    const { graded, byQuestion } = gradingInputs(loaded);
    const problems = approvalProblems(graded, byQuestion);
    if (problems.length) throw conflict("This attempt can't be approved yet.", problems);

    const score = finalScore(graded, byQuestion);
    await tx.attempt.update({
      where: { id: attemptId },
      data: {
        score,
        reviewStatus: "REVIEWED",
        reviewedById: actorId,
        reviewedAt: ctx.now,
        gradingVersion: { increment: 1 },
      },
    });
    await audit(tx, {
      action: "attempts.approved",
      actorId,
      entityType: "Attempt",
      entityId: attemptId,
      detail: { examId: attempt.examId, userId: attempt.userId, score, maxScore: num(attempt.maxScore) },
      ip: ctx.ip,
    });
  });
  return getGrading(ctx, attemptId);
}

/** Takes an approval back (T11): the score is cleared until the attempt is approved again. */
export async function reopenAttempt(ctx: Ctx, attemptId: string, input: z.infer<typeof reopenBody>) {
  const actorId = actorOf(ctx).userId;
  await inTransaction(ctx.db, async (tx) => {
    const attempt = await tx.attempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { exam: { select: { scoringMode: true } } },
    });
    assertGradable(attempt);
    const reopened = await tx.attempt.updateMany({
      where: { id: attemptId, reviewStatus: "REVIEWED" },
      data: {
        score: null,
        reviewStatus: "UNDER_REVIEW",
        reviewedById: null,
        reviewedAt: null,
        gradingVersion: { increment: 1 },
      },
    });
    if (reopened.count === 0) throw conflict("Only an approved attempt can be reopened.");
    await audit(tx, {
      action: "attempts.reopened",
      actorId,
      entityType: "Attempt",
      entityId: attemptId,
      detail: { examId: attempt.examId, userId: attempt.userId, reason: input.reason, score: num(attempt.score) },
      ip: ctx.ip,
    });
  });
  return getGrading(ctx, attemptId);
}

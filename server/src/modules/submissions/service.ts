import { z } from "zod";
import { actorOf, type Ctx } from "../../core/context.js";
import { conflict } from "../../core/errors.js";
import { pageArgs, toPage, type PageQuery } from "../../core/pagination.js";
import { uuid } from "../../core/schemas.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { attemptDetail, attemptScope, loadAttempt } from "../grading/service.js";
import { authorize } from "../rbac/authorize.js";
import { attemptWhere, examWhere, reachOf, reachOfAny, studentWhere, SUBMITTED_STATUSES } from "../rbac/scope.js";

// Submitted exams across every exam the caller may see results of, newest first, and a read-only
// preview of one (docs/API.md §6.4). Staff only. An instructor without grants gets empty lists,
// never an error: their dashboard always works.

/** Seeing a submission needs RESULTS_VIEW or ATTEMPT_REVIEW on its exam and its student. */
const READ: ["RESULTS_VIEW", "ATTEMPT_REVIEW"] = ["RESULTS_VIEW", "ATTEMPT_REVIEW"];

export const submissionsQuery = z.object({
  examId: uuid.optional(),
  /** `awaiting-grading`: needs-approval exams not approved yet. */
  show: z.enum(["all", "awaiting-grading"]).default("all"),
  /** Student name or username, or exam code or title. */
  q: z.string().trim().max(100).optional(),
});

const person = { select: { id: true, username: true, fullName: true } } as const;
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const AWAITING: Prisma.AttemptWhereInput = {
  exam: { is: { scoringMode: "MANUAL_APPROVAL" } },
  reviewStatus: { not: "REVIEWED" },
};

function inScope(ctx: Ctx): Prisma.AttemptWhereInput {
  return { AND: [{ status: { in: SUBMITTED_STATUSES } }, attemptWhere(reachOfAny(actorOf(ctx), READ, ctx.now))] };
}

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

export async function listSubmissions(ctx: Ctx, filter: z.infer<typeof submissionsQuery>, page: PageQuery) {
  const q = filter.q;
  const search: Prisma.AttemptWhereInput = q
    ? {
        OR: [
          { user: { is: { fullName: contains(q) } } },
          { user: { is: { username: contains(q) } } },
          { exam: { is: { title: contains(q) } } },
          { exam: { is: { code: contains(q) } } },
        ],
      }
    : {};
  const rows = await ctx.db.attempt.findMany({
    where: {
      AND: [
        inScope(ctx),
        filter.examId ? { examId: filter.examId } : {},
        filter.show === "awaiting-grading" ? AWAITING : {},
        search,
      ],
    },
    include: { user: person, exam: { select: { id: true, code: true, title: true, scoringMode: true } } },
    orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    ...pageArgs(page),
  });

  // The latest attempt of each student on each exam: only that one can get "another attempt".
  const latest = await ctx.db.attempt.groupBy({
    by: ["examId", "userId"],
    where: { examId: { in: rows.map((r) => r.examId) }, userId: { in: rows.map((r) => r.userId) } },
    _max: { attemptNo: true },
  });
  const latestNo = new Map(latest.map((l) => [`${l.examId}:${l.userId}`, l._max.attemptNo]));

  return toPage(rows, page, (r) => ({
    attemptId: r.id,
    attemptNo: r.attemptNo,
    isLatest: latestNo.get(`${r.examId}:${r.userId}`) === r.attemptNo,
    exam: r.exam,
    student: r.user,
    status: r.status,
    submittedAt: r.submittedAt,
    reviewStatus: r.reviewStatus,
    awaitingGrading: r.exam.scoringMode === "MANUAL_APPROVAL" && r.reviewStatus !== "REVIEWED",
    score: num(r.score),
    maxScore: num(r.maxScore),
  }));
}

/** One submitted exam, read only: every question, the student's answers, the key and the points. */
export async function previewSubmission(ctx: Ctx, attemptId: string) {
  const loaded = await loadAttempt(ctx.db, attemptId);
  const { attempt } = loaded;
  if (attempt.status === "IN_PROGRESS") throw conflict("The student is still taking this exam.");
  const [detail, scope, newer] = await Promise.all([
    attemptDetail(ctx, loaded),
    attemptScope(ctx.db, attemptId),
    ctx.db.attempt.count({
      where: { examId: attempt.examId, userId: attempt.userId, attemptNo: { gt: attempt.attemptNo } },
    }),
  ]);
  const actor = actorOf(ctx);
  const manual = attempt.exam.scoringMode === "MANUAL_APPROVAL";
  const voided = attempt.status === "VOIDED";
  return {
    ...detail,
    approvalProblems: manual ? detail.approvalProblems : [],
    /** Open it on the grading page (needs-approval exams, ATTEMPT_REVIEW). */
    canGrade: manual && !voided && authorize(actor, "ATTEMPT_REVIEW", scope, ctx.now),
    /** The student's latest attempt, and the caller may assign the exam to them. */
    canGiveAnotherAttempt: !voided && newer === 0 && authorize(actor, "EXAM_ASSIGN", scope, ctx.now),
  };
}

/** The numbers on a staff member's dashboard, all within their own scope (zero without grants). */
export async function dashboard(ctx: Ctx) {
  const any = reachOf(actorOf(ctx), "any", ctx.now);
  const submitted = inScope(ctx);
  const weekAgo = new Date(ctx.now.getTime() - 7 * 24 * 3_600_000);
  const [exams, students, total, awaitingGrading, lastWeek] = await Promise.all([
    ctx.db.exam.count({ where: { AND: [examWhere(any), { status: { not: "ARCHIVED" } }] } }),
    ctx.db.user.count({ where: { AND: [studentWhere(any), { isActive: true }] } }),
    ctx.db.attempt.count({ where: submitted }),
    ctx.db.attempt.count({ where: { AND: [submitted, AWAITING] } }),
    ctx.db.attempt.count({ where: { AND: [submitted, { submittedAt: { gte: weekAgo } }] } }),
  ]);
  return { exams, students, submissions: { total, awaitingGrading, lastWeek } };
}

import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction } from "../../core/db.js";
import { notFound } from "../../core/errors.js";
import { attemptWhere, reachOfAny, SUBMITTED_STATUSES } from "../rbac/scope.js";

// Showing results to students (RES-3). Until staff release an exam's results, students see that
// they submitted, never their score. Releasing shows each student their own score and pass/fail
// (only once their attempt is graded); hiding it again takes the scores away.

export const releaseBody = z.object({ released: z.boolean() });

/**
 * Whether students see this exam's results, and how far grading is. Counts cover only the
 * submitted attempts of students the caller reaches.
 */
export async function resultsStatus(ctx: Ctx, examId: string) {
  const exam = await ctx.db.exam.findUnique({
    where: { id: examId },
    select: { resultsReleased: true, resultsReleasedAt: true },
  });
  if (!exam) throw notFound("Exam not found.");
  const reach = reachOfAny(actorOf(ctx), ["RESULTS_VIEW", "RESULTS_RELEASE", "ATTEMPT_REVIEW"], ctx.now);
  const where = { AND: [{ examId, status: { in: SUBMITTED_STATUSES } }, attemptWhere(reach)] };
  const [submitted, graded] = await Promise.all([
    ctx.db.attempt.count({ where }),
    ctx.db.attempt.count({ where: { AND: [where, { score: { not: null } }] } }),
  ]);
  return {
    released: exam.resultsReleased,
    releasedAt: exam.resultsReleasedAt,
    /** Submitted attempts (not voided). */
    submitted,
    /** Of those, attempts with a score (auto scored, or approved by a grader). */
    graded,
  };
}

export async function setResultsRelease(ctx: Ctx, examId: string, released: boolean) {
  const actor = actorOf(ctx);
  await inTransaction(ctx.db, async (tx) => {
    const before = await tx.exam.findUnique({ where: { id: examId }, select: { resultsReleased: true } });
    if (!before) throw notFound("Exam not found.");
    if (before.resultsReleased === released) return;
    await tx.exam.update({
      where: { id: examId },
      data: { resultsReleased: released, resultsReleasedAt: released ? ctx.now : null },
    });
    await audit(tx, {
      action: released ? "results.released" : "results.hidden",
      actorId: actor.userId,
      entityType: "Exam",
      entityId: examId,
      ip: ctx.ip,
    });
  });
  return resultsStatus(ctx, examId);
}

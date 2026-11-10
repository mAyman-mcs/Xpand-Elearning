import type { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { authorize } from "../rbac/authorize.js";
import { examTargetScope } from "./assignments.service.js";
import { resolveAvailability } from "./availability.js";
import { loadExamRules, loadStudents, rulesFor } from "./inputs.js";
import type { extraAttemptBody } from "./schemas.js";

// "Give another attempt" (re-assign a submitted exam to one student). The old attempts stay as
// they are, with their answers and grades: the student gets one more on top of maxAttempts.

const person = { select: { id: true, username: true, fullName: true } } as const;

/** One student's availability on one exam, as staff see it (the same shape as an AvailabilityRow). */
export async function studentAvailability(db: DbClient, examId: string, userId: string, now: Date) {
  const [students, exam, user] = await Promise.all([
    loadStudents(db, [userId]),
    db.exam.findUnique({ where: { id: examId }, select: { status: true, isExternal: true, maxAttempts: true } }),
    db.user.findUnique({ where: { id: userId }, ...person }),
  ]);
  const student = students.get(userId);
  if (!student || !exam || !user) throw notFound("Not found.");
  const rules = await loadExamRules(db, [examId], [student]);
  return { student: user, ...resolveAvailability({ exam, student, now, ...rulesFor(rules, examId, userId) }) };
}

/** Why another attempt can't be given now, in words staff can act on (null: it can). */
function refusal(row: Awaited<ReturnType<typeof studentAvailability>>): string | null {
  if (row.status === "SUBMITTED") return null;
  if (row.status === "NOT_ASSIGNED") return "This exam isn't assigned to the student. Assign it first.";
  if (row.status === "EXTERNAL") return "This exam is taken outside the platform: enter the score instead.";
  if (row.progress === "IN_PROGRESS") return "The student is taking this exam right now.";
  if (row.source === "exam") return row.reason;
  return "The student still has an attempt left. To let them take it now, open the exam for them.";
}

export async function giveExtraAttempt(ctx: Ctx, input: z.infer<typeof extraAttemptBody>) {
  const actor = actorOf(ctx);
  if (input.openUntil && input.openUntil <= ctx.now)
    throw new AppError("VALIDATION_FAILED", {
      message: "The end must be in the future.",
      details: [{ path: "openUntil", message: "The end must be in the future." }],
    });
  // Opening the exam is scheduling: it needs EXAM_SCHEDULE on top of EXAM_ASSIGN (checked by the route).
  if (input.openUntil) {
    const scope = await examTargetScope(ctx.db, input.examId, { userId: input.userId });
    if (!authorize(actor, "EXAM_SCHEDULE", scope, ctx.now))
      throw new AppError("FORBIDDEN", {
        message: "You may give another attempt, but not open the exam: leave “open it now” off.",
      });
  }

  await inTransaction(ctx.db, async (tx) => {
    // One at a time per student, so two clicks can't give two attempts.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId}::uuid FOR UPDATE`;
    const before = await studentAvailability(tx, input.examId, input.userId, ctx.now);
    const problem = refusal(before);
    if (problem) throw conflict(problem);

    const extra = await tx.extraAttempt.create({
      data: {
        examId: input.examId,
        userId: input.userId,
        reason: input.reason,
        createdById: actor.userId,
        createdAt: ctx.now,
      },
    });
    const override = input.openUntil
      ? await tx.accessOverride.create({
          data: {
            examId: input.examId,
            userId: input.userId,
            action: "OPEN",
            validFrom: ctx.now,
            validUntil: input.openUntil,
            reason: `Another attempt: ${input.reason}`,
            createdById: actor.userId,
            createdAt: ctx.now,
          },
        })
      : null;
    await audit(tx, {
      action: "attempts.extra_given",
      actorId: actor.userId,
      entityType: "ExtraAttempt",
      entityId: extra.id,
      detail: {
        examId: input.examId,
        userId: input.userId,
        reason: input.reason,
        openUntil: input.openUntil?.toISOString() ?? null,
        overrideId: override?.id ?? null,
      },
      ip: ctx.ip,
    });
  });
  return studentAvailability(ctx.db, input.examId, input.userId, ctx.now);
}

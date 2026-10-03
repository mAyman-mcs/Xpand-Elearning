import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import type { Assignment, Prisma } from "../../generated/prisma/client.js";
import { authorize, type Scope } from "../rbac/authorize.js";
import { examScope, targetScope } from "../rbac/resolvers.js";
import { examWhere, reachForExam, reachOf, targetWhere } from "../rbac/scope.js";
import { anchorFor, scheduleWindow } from "./availability.js";
import { loadStudents } from "./inputs.js";
import { scheduleColumns, type BulkAssignment, type Schedule, type Target } from "./schemas.js";

// ─────────────────────────────── Scopes ───────────────────────────────

/** Exam × target: what an assignment or override touches. */
export async function examTargetScope(db: DbClient, examId: string, target: Target): Promise<Scope> {
  const [exam, who] = await Promise.all([examScope(db, examId), targetScope(db, target)]);
  return { ...exam, ...who };
}

export async function assignmentScope(db: DbClient, assignmentId: string): Promise<Scope> {
  const a = await db.assignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw notFound("Assignment not found.");
  return examTargetScope(db, a.examId, { userId: a.userId ?? undefined, groupId: a.groupId ?? undefined });
}

// ──────────────────────────────── DTOs ────────────────────────────────

const withTarget = {
  user: { select: { id: true, username: true, fullName: true } },
  group: { select: { id: true, name: true } },
} satisfies Prisma.AssignmentInclude;
type AssignmentRow = Prisma.AssignmentGetPayload<{ include: typeof withTarget }>;

export function assignmentDto(a: AssignmentRow) {
  return {
    id: a.id,
    examId: a.examId,
    target: a.user
      ? { type: "user" as const, id: a.user.id, name: a.user.fullName, username: a.user.username }
      : { type: "group" as const, id: a.group?.id ?? "", name: a.group?.name ?? "" },
    schedule: {
      mode: a.mode,
      opensAt: a.opensAt,
      closesAt: a.closesAt,
      offsetDays: a.offsetDays,
      openTime: a.openTime,
      windowMinutes: a.windowMinutes,
    },
    createdAt: a.createdAt,
    createdById: a.createdById,
  };
}

function auditDetail(a: Assignment): Prisma.InputJsonObject {
  return {
    examId: a.examId,
    userId: a.userId,
    groupId: a.groupId,
    mode: a.mode,
    opensAt: a.opensAt?.toISOString() ?? null,
    closesAt: a.closesAt?.toISOString() ?? null,
    offsetDays: a.offsetDays,
    openTime: a.openTime,
    windowMinutes: a.windowMinutes,
  };
}

const alreadyAssigned = () => conflict("This exam is already assigned to that target; edit the existing assignment.");

// ─────────────────────────────── Single ───────────────────────────────

/** Assignments of one exam whose target the caller reaches for that exam. */
export async function listAssignments(ctx: Ctx, examId: string) {
  const exam = await ctx.db.exam.findUniqueOrThrow({ where: { id: examId }, select: { id: true, categoryId: true } });
  const reach = reachForExam(reachOf(actorOf(ctx), "any", ctx.now), exam);
  const rows = await ctx.db.assignment.findMany({
    where: { AND: [{ examId }, targetWhere(reach)] },
    include: withTarget,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(assignmentDto);
}

async function assertAssignable(db: DbClient, examId: string) {
  const exam = await db.exam.findUnique({ where: { id: examId }, select: { status: true } });
  if (exam?.status === "ARCHIVED") {
    throw new AppError("VALIDATION_FAILED", { details: [{ path: "examId", message: "The exam is archived." }] });
  }
}

export async function createAssignment(ctx: Ctx, input: { examId: string; target: Target; schedule: Schedule }) {
  const actor = actorOf(ctx);
  try {
    return await inTransaction(ctx.db, async (tx) => {
      await assertAssignable(tx, input.examId);
      const created = await tx.assignment.create({
        data: {
          examId: input.examId,
          userId: input.target.userId ?? null,
          groupId: input.target.groupId ?? null,
          ...scheduleColumns(input.schedule),
          createdById: actor.userId,
        },
        include: withTarget,
      });
      await audit(tx, {
        action: "assignments.created",
        actorId: actor.userId,
        entityType: "Assignment",
        entityId: created.id,
        detail: auditDetail(created),
        ip: ctx.ip,
      });
      return assignmentDto(created);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw alreadyAssigned();
    throw err;
  }
}

export async function updateAssignment(ctx: Ctx, assignmentId: string, schedule: Schedule) {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.assignment.findUnique({ where: { id: assignmentId } });
    if (!before) throw notFound("Assignment not found.");
    const updated = await tx.assignment.update({
      where: { id: assignmentId },
      data: scheduleColumns(schedule),
      include: withTarget,
    });
    await audit(tx, {
      action: "assignments.rescheduled",
      actorId: actor.userId,
      entityType: "Assignment",
      entityId: assignmentId,
      detail: { before: auditDetail(before), after: auditDetail(updated) },
      ip: ctx.ip,
    });
    return assignmentDto(updated);
  });
}

export async function deleteAssignment(ctx: Ctx, assignmentId: string): Promise<void> {
  const actor = actorOf(ctx);
  await inTransaction(ctx.db, async (tx) => {
    const existing = await tx.assignment.findUnique({ where: { id: assignmentId } });
    if (!existing) throw notFound("Assignment not found.");
    await tx.assignment.delete({ where: { id: assignmentId } });
    await audit(tx, {
      action: "assignments.deleted",
      actorId: actor.userId,
      entityType: "Assignment",
      entityId: assignmentId,
      detail: auditDetail(existing),
      ip: ctx.ip,
    });
  });
}

// ──────────────────────────── Bulk & preview ────────────────────────────

interface Pair {
  exam: { id: string; categoryId: string; title: string };
  target: Target;
  groupIds: string[];
}

/**
 * Resolves the exam selection and targets into pairs and checks EXAM_ASSIGN on every pair.
 * All or nothing: one refused pair refuses the whole request (and lists the refused pairs).
 * Exams selected by category or tags are limited to exams the caller can see at all.
 */
async function resolvePairs(ctx: Ctx, body: BulkAssignment): Promise<Pair[]> {
  const actor = actorOf(ctx);
  const visible = examWhere(reachOf(actor, "any", ctx.now));
  const select = { id: true, categoryId: true, title: true, status: true } as const;

  // Exams the caller cannot see at all are treated as non-existent.
  let exams: { id: string; categoryId: string; title: string; status: string }[];
  if (body.examIds) {
    exams = await ctx.db.exam.findMany({ where: { AND: [{ id: { in: body.examIds } }, visible] }, select });
    if (exams.length !== body.examIds.length) {
      throw new AppError("VALIDATION_FAILED", { details: [{ path: "examIds", message: "Some exams do not exist." }] });
    }
  } else {
    const where: Prisma.ExamWhereInput = body.categoryId
      ? { categoryId: body.categoryId }
      : { AND: (body.tagIds ?? []).map((tagId) => ({ tags: { some: { tagId } } })) };
    exams = await ctx.db.exam.findMany({ where: { AND: [where, visible, { status: { not: "ARCHIVED" } }] }, select });
  }
  if (exams.length === 0) {
    throw new AppError("VALIDATION_FAILED", {
      details: [{ path: "examIds", message: "No exams match the selection." }],
    });
  }
  if (exams.some((e) => e.status === "ARCHIVED")) {
    throw new AppError("VALIDATION_FAILED", {
      details: [{ path: "examIds", message: "Archived exams cannot be assigned." }],
    });
  }

  const targetGroups = await Promise.all(body.targets.map((t) => targetScope(ctx.db, t)));
  const pairs = exams.flatMap((exam) =>
    body.targets.map((target, i) => ({ exam, target, groupIds: targetGroups[i]?.groupIds ?? [] })),
  );
  const refused = pairs.filter(
    (p) =>
      !authorize(
        actor,
        "EXAM_ASSIGN",
        { examId: p.exam.id, categoryId: p.exam.categoryId, groupIds: p.groupIds },
        ctx.now,
      ),
  );
  if (refused.length) {
    throw new AppError("FORBIDDEN", {
      message: "You may not assign some of these exams to some of these targets; nothing was assigned.",
      details: refused.map((p) => ({ examId: p.exam.id, target: p.target })),
    });
  }
  return pairs;
}

export async function bulkAssign(ctx: Ctx, body: BulkAssignment) {
  const actor = actorOf(ctx);
  const pairs = await resolvePairs(ctx, body);
  const columns = scheduleColumns(body.schedule);

  return inTransaction(ctx.db, async (tx) => {
    const existing = await tx.assignment.findMany({
      where: {
        OR: pairs.map((p) => ({
          examId: p.exam.id,
          ...(p.target.userId ? { userId: p.target.userId } : { groupId: p.target.groupId }),
        })),
      },
      select: { examId: true, userId: true, groupId: true },
    });
    if (existing.length) {
      throw conflict("Some of these exams are already assigned to these targets; nothing was assigned.", existing);
    }
    const rows = pairs.map((p) => ({
      examId: p.exam.id,
      userId: p.target.userId ?? null,
      groupId: p.target.groupId ?? null,
      ...columns,
      createdById: actor.userId,
    }));
    await tx.assignment.createMany({ data: rows });
    await audit(tx, {
      action: "assignments.bulk_created",
      actorId: actor.userId,
      entityType: "Assignment",
      detail: {
        count: rows.length,
        examIds: [...new Set(rows.map((r) => r.examId))],
        targets: body.targets,
        schedule: {
          ...columns,
          opensAt: columns.opensAt?.toISOString() ?? null,
          closesAt: columns.closesAt?.toISOString() ?? null,
        },
      },
      ip: ctx.ip,
    });
    return { created: rows.length };
  });
}

/**
 * What a schedule would mean for every affected student, without saving anything. Uses the same
 * window calculation as the resolver, so the preview always matches what students will see.
 */
export async function previewAssignments(ctx: Ctx, body: BulkAssignment) {
  const pairs = await resolvePairs(ctx, body);
  const columns = scheduleColumns(body.schedule);

  const groupIds = [...new Set(pairs.flatMap((p) => (p.target.groupId ? [p.target.groupId] : [])))];
  const members = await ctx.db.groupMember.findMany({
    where: { groupId: { in: groupIds } },
    select: { groupId: true, userId: true },
  });
  const studentIds = [
    ...new Set([...members.map((m) => m.userId), ...pairs.flatMap((p) => (p.target.userId ? [p.target.userId] : []))]),
  ];
  const [students, people, personal] = await Promise.all([
    loadStudents(ctx.db, studentIds),
    ctx.db.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, username: true, fullName: true } }),
    ctx.db.assignment.findMany({
      where: { examId: { in: pairs.map((p) => p.exam.id) }, userId: { in: studentIds } },
      select: { examId: true, userId: true },
    }),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));

  return pairs.flatMap((pair) => {
    const ids = pair.target.userId
      ? [pair.target.userId]
      : members.filter((m) => m.groupId === pair.target.groupId).map((m) => m.userId);
    return ids.flatMap((userId) => {
      const student = students.get(userId);
      if (!student) return [];
      const assignment = { userId: pair.target.userId ?? null, groupId: pair.target.groupId ?? null };
      const anchor = anchorFor(assignment, student);
      const window = scheduleWindow(columns, anchor);
      return [
        {
          examId: pair.exam.id,
          examTitle: pair.exam.title,
          student: person.get(userId),
          anchorDate: anchor,
          opensAt: window?.opensAt ?? null,
          closesAt: window?.closesAt ?? null,
          // A personal assignment replaces group ones (D7): this group schedule would not apply.
          replacedByPersonalAssignment:
            !pair.target.userId && personal.some((p) => p.examId === pair.exam.id && p.userId === userId),
        },
      ];
    });
  });
}

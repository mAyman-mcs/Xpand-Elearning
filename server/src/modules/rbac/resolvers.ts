import type { DbClient } from "../../core/db.js";
import { notFound } from "../../core/errors.js";
import type { ExamRef, Scope } from "./authorize.js";
import { SUBMITTED_STATUSES } from "./scope.js";

// Turn request targets into a Scope, in one place each. A missing target is NOT_FOUND —
// the same answer an out-of-scope caller gets, so existence is never revealed.

const examRefSelect = { id: true, categoryId: true, tags: { select: { tagId: true } } } as const;
const toRef = (e: { id: string; categoryId: string; tags: { tagId: string }[] }): ExamRef => ({
  examId: e.id,
  categoryId: e.categoryId,
  tagIds: e.tags.map((t) => t.tagId),
});

/** An exam, with its category and tags (tag grants cover exams by tag). */
export async function examScope(db: DbClient, examId: string): Promise<Scope> {
  const exam = await db.exam.findUnique({ where: { id: examId }, select: examRefSelect });
  if (!exam) throw notFound("Exam not found.");
  return toRef(exam);
}

/** A question or material is in the scope of its exam. */
export async function questionScope(db: DbClient, questionId: string): Promise<Scope> {
  const q = await db.question.findUnique({ where: { id: questionId }, select: { examId: true } });
  if (!q) throw notFound("Question not found.");
  return examScope(db, q.examId);
}

export async function materialScope(db: DbClient, materialId: string): Promise<Scope> {
  const m = await db.material.findUnique({ where: { id: materialId }, select: { examId: true } });
  if (!m) throw notFound("Material not found.");
  return examScope(db, m.examId);
}

export async function categoryScope(db: DbClient, categoryId: string): Promise<Scope> {
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) throw notFound("Category not found.");
  return { categoryId: category.id };
}

export async function groupScope(db: DbClient, groupId: string): Promise<Scope> {
  const group = await db.group.findUnique({ where: { id: groupId }, select: { id: true } });
  if (!group) throw notFound("Group not found.");
  return { groupIds: [group.id] };
}

/**
 * A student is in scope through any of their groups (decision D6), or — for "students who
 * submitted" grants — through the exams they have submitted.
 */
export async function studentScope(db: DbClient, userId: string): Promise<Scope> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      memberships: { select: { groupId: true } },
      attempts: { where: { status: { in: SUBMITTED_STATUSES } }, select: { exam: { select: examRefSelect } } },
    },
  });
  if (user?.role !== "STUDENT") throw notFound("Student not found.");
  return { groupIds: user.memberships.map((m) => m.groupId), submitted: user.attempts.map((a) => toRef(a.exam)) };
}

/** An assignment/override target: exactly one of a user or a group. */
export function targetScope(db: DbClient, target: { userId?: string | null; groupId?: string | null }): Promise<Scope> {
  if (target.userId) return studentScope(db, target.userId);
  if (target.groupId) return groupScope(db, target.groupId);
  throw new Error("target needs a userId or a groupId");
}

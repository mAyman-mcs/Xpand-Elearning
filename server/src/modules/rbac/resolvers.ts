import type { DbClient } from "../../core/db.js";
import { notFound } from "../../core/errors.js";
import type { Scope } from "./authorize.js";

// Turn request targets into a Scope, in one place each. A missing target is NOT_FOUND —
// the same answer an out-of-scope caller gets, so existence is never revealed.

export async function examScope(db: DbClient, examId: string): Promise<Scope> {
  const exam = await db.exam.findUnique({ where: { id: examId }, select: { id: true, categoryId: true } });
  if (!exam) throw notFound("Exam not found.");
  return { examId: exam.id, categoryId: exam.categoryId };
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

/** A student is in scope through any of their groups (decision D6). */
export async function studentScope(db: DbClient, userId: string): Promise<Scope> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, memberships: { select: { groupId: true } } },
  });
  if (user?.role !== "STUDENT") throw notFound("Student not found.");
  return { groupIds: user.memberships.map((m) => m.groupId) };
}

/** An assignment/override target: exactly one of a user or a group. */
export function targetScope(db: DbClient, target: { userId?: string | null; groupId?: string | null }): Promise<Scope> {
  if (target.userId) return studentScope(db, target.userId);
  if (target.groupId) return groupScope(db, target.groupId);
  throw new Error("target needs a userId or a groupId");
}

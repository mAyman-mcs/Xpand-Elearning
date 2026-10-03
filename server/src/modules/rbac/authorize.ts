import type { Permission, Role } from "../../generated/prisma/enums.js";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "EXAM_EDIT",
  "EXAM_ASSIGN",
  "EXAM_SCHEDULE",
  "RESULTS_VIEW",
  "RESULTS_RELEASE",
  "PROCTOR",
  "ATTEMPT_VOID",
  "ATTEMPT_REVIEW",
  "AUDIT_VIEW",
];

/** One instructor grant: permissions × exam scope × group scope (see docs/ARCHITECTURE.md). */
export interface GrantScope {
  permissions: Permission[];
  allExams: boolean;
  examIds: string[];
  /** Covers every exam in these categories, including ones created later. */
  categoryIds: string[];
  allGroups: boolean;
  groupIds: string[];
  expiresAt: Date | null;
}

export interface Principal {
  userId: string;
  role: Role;
  grants: GrantScope[];
}

/**
 * What an action touches. Omitted fields are not constrained (e.g. opening a list page; the
 * list query must then be filtered with scope.ts).
 * - `examId` + `categoryId`: the exam and the category it belongs to. `categoryId` alone means
 *   "something in this category" (e.g. creating an exam there).
 * - `groupIds`: the group targeted, or every group of the student targeted. An empty array
 *   (a student in no group) is only covered by all-groups grants.
 */
export interface Scope {
  examId?: string;
  categoryId?: string;
  groupIds?: string[];
}

export function isActive(g: Pick<GrantScope, "expiresAt">, now: Date): boolean {
  return g.expiresAt === null || g.expiresAt > now;
}

export function coversExam(g: GrantScope, scope: Pick<Scope, "examId" | "categoryId">): boolean {
  if (scope.examId === undefined && scope.categoryId === undefined) return true;
  if (g.allExams) return true;
  if (scope.examId !== undefined && g.examIds.includes(scope.examId)) return true;
  return scope.categoryId !== undefined && g.categoryIds.includes(scope.categoryId);
}

export function coversGroups(g: GrantScope, groupIds: string[] | undefined): boolean {
  if (groupIds === undefined || g.allGroups) return true;
  return groupIds.some((id) => g.groupIds.includes(id));
}

/** Unexpired grants of this principal that include the permission. */
export function activeGrants(p: Principal, permission: Permission, now: Date): GrantScope[] {
  return p.grants.filter((g) => g.permissions.includes(permission) && isActive(g, now));
}

/**
 * Super admins may do everything. Instructors need a single unexpired grant that includes the
 * permission AND covers both the exam and the group(s) — scopes from different grants are never
 * combined (exam A × group X plus exam B × group Y does not allow A × Y). Students hold no staff
 * permissions; access to their own data is checked by ownership instead.
 */
export function authorize(p: Principal, permission: Permission, scope: Scope, now: Date): boolean {
  if (p.role === "SUPER_ADMIN") return true;
  if (p.role !== "INSTRUCTOR") return false;
  return activeGrants(p, permission, now).some((g) => coversExam(g, scope) && coversGroups(g, scope.groupIds));
}

/** True when any permission reaches this scope — used to answer 403 (visible) vs 404 (hidden). */
export function canSeeAnything(p: Principal, scope: Scope, now: Date): boolean {
  return ALL_PERMISSIONS.some((perm) => authorize(p, perm, scope, now));
}

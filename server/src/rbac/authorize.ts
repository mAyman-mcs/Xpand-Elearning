import type { Permission, Role } from "../generated/prisma/enums.js";

export interface GrantScope {
  permissions: Permission[];
  allExams: boolean;
  allGroups: boolean;
  examIds: string[];
  groupIds: string[];
  expiresAt: Date | null;
}

export interface Principal {
  userId: string;
  role: Role;
  grants: GrantScope[];
}

/**
 * What an action touches. Omitted fields mean "not tied to a specific exam/group"
 * (e.g. opening a list page); the list query must then be filtered with {@link activeGrants}.
 */
export interface Scope {
  examId?: string;
  groupId?: string;
}

function grantCovers(g: GrantScope, scope: Scope): boolean {
  const examOk = scope.examId === undefined || g.allExams || g.examIds.includes(scope.examId);
  const groupOk = scope.groupId === undefined || g.allGroups || g.groupIds.includes(scope.groupId);
  return examOk && groupOk;
}

/** Unexpired grants of this principal that include the permission. */
export function activeGrants(p: Principal, permission: Permission, now = new Date()): GrantScope[] {
  return p.grants.filter((g) => g.permissions.includes(permission) && (g.expiresAt === null || g.expiresAt > now));
}

/**
 * Super admins may do everything. Instructors need a single unexpired grant that includes
 * the permission AND covers both the exam and the group — scopes from different grants are
 * never combined (a grant for exam A × group X plus one for exam B × group Y does not allow A × Y).
 * Students hold no staff permissions; access to their own data is checked by ownership instead.
 */
export function authorize(p: Principal, permission: Permission, scope: Scope = {}, now = new Date()): boolean {
  if (p.role === "SUPER_ADMIN") return true;
  if (p.role !== "INSTRUCTOR") return false;
  return activeGrants(p, permission, now).some((g) => grantCovers(g, scope));
}

import type { MyPermissions, Permission } from "@contracts";

// Decides what the UI SHOWS. It is never a security check: the server checks every request and the
// screens handle its 403/404 answers (FRONTEND_GUIDE §3).

export interface ExamRef {
  id: string;
  categoryId: string;
}

/** May the caller (probably) do `permission`, on this exam if given? Mirrors the server's rule. */
export function can(perms: MyPermissions | undefined, permission: Permission, exam?: ExamRef): boolean {
  if (!perms) return false;
  if (perms.role === "SUPER_ADMIN") return true;
  if (perms.role !== "INSTRUCTOR") return false;
  return perms.grants.some(
    (g) =>
      g.permissions.includes(permission) &&
      (!exam || g.allExams || g.examIds.includes(exam.id) || g.categoryIds.includes(exam.categoryId)),
  );
}

/** Any permission at all on any exam (instructors with no active grant see an empty dashboard). */
export function hasAnyGrant(perms: MyPermissions | undefined): boolean {
  return perms?.role === "SUPER_ADMIN" || (perms?.grants.length ?? 0) > 0;
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  EXAM_EDIT: "Edit exams and questions",
  EXAM_ASSIGN: "Assign exams",
  EXAM_SCHEDULE: "Schedule and open/close exams",
  RESULTS_VIEW: "View results",
  RESULTS_RELEASE: "Publish results to students",
  PROCTOR: "Proctor live sessions",
  ATTEMPT_VOID: "Void or reopen attempts",
  ATTEMPT_REVIEW: "Review attempts",
  AUDIT_VIEW: "View audit log",
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

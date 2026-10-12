import type { Category, MyPermissions } from "@contracts";

/**
 * Categories the caller may create exams in (or move exams to): every category for super admins and
 * EXAM_EDIT grants on all exams; otherwise the categories listed in EXAM_EDIT grants. Display only:
 * the server checks the category again.
 */
export function editableCategories(perms: MyPermissions | undefined, categories: Category[]): Category[] {
  if (!perms) return [];
  if (perms.role === "SUPER_ADMIN") return categories;
  const edit = perms.grants.filter((g) => g.permissions.includes("EXAM_EDIT"));
  if (edit.some((g) => g.allExams)) return categories;
  const allowed = new Set(edit.flatMap((g) => g.categoryIds));
  return categories.filter((c) => allowed.has(c.id));
}

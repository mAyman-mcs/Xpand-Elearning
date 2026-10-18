import type { GrantScopeFields } from "@contracts";
import { PERMISSION_LABELS } from "./permissions";
import { formatInstant } from "./time";

export interface ScopeNames {
  exams: Map<string, string>;
  categories: Map<string, string>;
  tags: Map<string, string>;
  groups: Map<string, string>;
}

/** "a", "a or b", "a, b or c" */
function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1) ?? ""}`;
}

/** "a", "a and b", "a, b and c" */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

const name = (map: Map<string, string>, id: string) => map.get(id) ?? "(deleted)";

/**
 * A grant as one readable sentence (FRONTEND_GUIDE §4.4), e.g.
 * "Can assign exams and view results for exams in Cloud, for students in Intake July 2026, until 31 Dec 2026, 23:59 Cairo."
 */
export function grantSentence(g: GrantScopeFields, names: ScopeNames): string {
  const perms = joinList(g.permissions.map((p) => PERMISSION_LABELS[p].toLowerCase()));

  const examParts = [
    g.categoryIds.length ? `exams in ${joinList(g.categoryIds.map((id) => name(names.categories, id)))}` : "",
    g.tagIds.length ? `exams tagged ${joinOr(g.tagIds.map((id) => `“${name(names.tags, id)}”`))}` : "",
    g.examIds.length
      ? `${g.examIds.length === 1 ? "the exam" : "the exams"} ${joinList(g.examIds.map((id) => `“${name(names.exams, id)}”`))}`
      : "",
  ].filter(Boolean);
  const exams = g.allExams ? "all exams" : examParts.join(" and ") || "no exams";

  const groups = g.allGroups
    ? "students in every group"
    : g.studentsWhoSubmitted
      ? "only students who have submitted one of these exams"
      : g.groupIds.length
        ? `students in ${joinList(g.groupIds.map((id) => name(names.groups, id)))}`
        : "no students";

  const until = g.expiresAt ? `, until ${formatInstant(g.expiresAt)}` : "";
  return `Can ${perms} for ${exams}, for ${groups}${until}.`;
}

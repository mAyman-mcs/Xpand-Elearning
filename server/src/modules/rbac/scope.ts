import type { Prisma } from "../../generated/prisma/client.js";
import type { Permission } from "../../generated/prisma/enums.js";
import {
  activeGrants,
  coversExam,
  coversGroups,
  isActive,
  type GrantScope,
  type Principal,
  type Scope,
} from "./authorize.js";

/**
 * A principal's reach for one permission, as exam-scope × group-scope pairs (one per grant).
 * Every list filter is built from this, so list queries can never combine scopes across grants.
 */
export type Reach =
  | { kind: "everything" }
  | {
      kind: "pairs";
      pairs: { exams: "all" | { examIds: string[]; categoryIds: string[] }; groups: "all" | string[] }[];
    };

/** `"any"` = reachable through at least one permission (what the caller may see at all). */
export function reachOf(p: Principal, permission: Permission | "any", now: Date): Reach {
  if (p.role === "SUPER_ADMIN") return { kind: "everything" };
  if (p.role !== "INSTRUCTOR") return { kind: "pairs", pairs: [] };

  const grants: GrantScope[] =
    permission === "any"
      ? p.grants.filter((g) => isActive(g, now) && g.permissions.length > 0)
      : activeGrants(p, permission, now);
  return {
    kind: "pairs",
    pairs: grants.map((g) => ({
      exams: g.allExams ? "all" : { examIds: g.examIds, categoryIds: g.categoryIds },
      groups: g.allGroups ? "all" : g.groupIds,
    })),
  };
}

/** Keeps only the pairs whose exam side covers this exam (for "students of exam X" lists). */
export function reachForExam(reach: Reach, exam: { id: string; categoryId: string }): Reach {
  if (reach.kind === "everything") return reach;
  const toGrant = (pair: (typeof reach.pairs)[number]): GrantScope => ({
    permissions: [],
    allExams: pair.exams === "all",
    examIds: pair.exams === "all" ? [] : pair.exams.examIds,
    categoryIds: pair.exams === "all" ? [] : pair.exams.categoryIds,
    allGroups: true,
    groupIds: [],
    expiresAt: null,
  });
  return {
    kind: "pairs",
    pairs: reach.pairs.filter((pair) => coversExam(toGrant(pair), { examId: exam.id, categoryId: exam.categoryId })),
  };
}

/** Pure evaluation of a Reach — mirrors the Prisma filters below; used to cross-check against authorize(). */
export function reachAllows(reach: Reach, scope: Scope): boolean {
  if (reach.kind === "everything") return true;
  return reach.pairs.some((pair) => {
    const grant: GrantScope = {
      permissions: [],
      allExams: pair.exams === "all",
      examIds: pair.exams === "all" ? [] : pair.exams.examIds,
      categoryIds: pair.exams === "all" ? [] : pair.exams.categoryIds,
      allGroups: pair.groups === "all",
      groupIds: pair.groups === "all" ? [] : pair.groups,
      expiresAt: null,
    };
    return coversExam(grant, scope) && coversGroups(grant, scope.groupIds);
  });
}

const NOTHING = { id: { in: [] as string[] } };

/** Exams the principal can reach (group side ignored: seeing an exam does not depend on groups). */
export function examWhere(reach: Reach): Prisma.ExamWhereInput {
  if (reach.kind === "everything" || reach.pairs.some((p) => p.exams === "all")) return {};
  const or: Prisma.ExamWhereInput[] = reach.pairs.flatMap((p) =>
    p.exams === "all"
      ? []
      : [
          ...(p.exams.examIds.length ? [{ id: { in: p.exams.examIds } }] : []),
          ...(p.exams.categoryIds.length ? [{ categoryId: { in: p.exams.categoryIds } }] : []),
        ],
  );
  return or.length ? { OR: or } : NOTHING;
}

/** Groups the principal can reach (call with reachForExam(...) to restrict to one exam). */
export function groupWhere(reach: Reach): Prisma.GroupWhereInput {
  const groups = groupSide(reach);
  if (groups === "all") return {};
  return groups.length ? { id: { in: groups } } : NOTHING;
}

/** Students the principal can reach: members of at least one reachable group (decision D6). */
export function studentWhere(reach: Reach): Prisma.UserWhereInput {
  const groups = groupSide(reach);
  if (groups === "all") return { role: "STUDENT" };
  return groups.length ? { role: "STUDENT", memberships: { some: { groupId: { in: groups } } } } : NOTHING;
}

function groupSide(reach: Reach): "all" | string[] {
  if (reach.kind === "everything" || reach.pairs.some((p) => p.groups === "all")) return "all";
  return [...new Set(reach.pairs.flatMap((p) => (p.groups === "all" ? [] : p.groups)))];
}

/**
 * Assignments / overrides whose target is reachable: a reachable group, or a reachable student.
 * Combine with reachForExam(...) so the exam side of each grant is respected.
 */
export function targetWhere(reach: Reach) {
  if (groupSide(reach) === "all") return {};
  return { OR: [{ group: { is: groupWhere(reach) } }, { user: { is: studentWhere(reach) } }] };
}

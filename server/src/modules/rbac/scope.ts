import type { Prisma } from "../../generated/prisma/client.js";
import type { AttemptStatus, Permission } from "../../generated/prisma/enums.js";
import {
  activeGrants,
  coversExam,
  coversStudents,
  isActive,
  type GrantScope,
  type Principal,
  type Scope,
} from "./authorize.js";

/** Attempts that count as "submitted" for "students who submitted" grants (not in progress, not voided). */
export const SUBMITTED_STATUSES: AttemptStatus[] = ["SUBMITTED", "AUTO_SUBMITTED", "FORCE_SUBMITTED"];

type ExamSide = "all" | { examIds: string[]; categoryIds: string[]; tagIds: string[] };
type StudentSide = "all" | "submitted" | string[];

/**
 * A principal's reach for one permission, as exam-side × student-side pairs (one per grant).
 * Every list filter is built from this, so list queries can never combine scopes across grants.
 */
export type Reach = { kind: "everything" } | { kind: "pairs"; pairs: { exams: ExamSide; groups: StudentSide }[] };

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
      exams: g.allExams ? "all" : { examIds: g.examIds, categoryIds: g.categoryIds, tagIds: g.tagIds },
      groups: g.allGroups ? "all" : g.studentsWhoSubmitted ? "submitted" : g.groupIds,
    })),
  };
}

/** A pair as a grant, so the pure rules in authorize.ts decide (one source of truth). */
function asGrant(pair: { exams: ExamSide; groups: StudentSide }): GrantScope {
  return {
    permissions: [],
    allExams: pair.exams === "all",
    examIds: pair.exams === "all" ? [] : pair.exams.examIds,
    categoryIds: pair.exams === "all" ? [] : pair.exams.categoryIds,
    tagIds: pair.exams === "all" ? [] : pair.exams.tagIds,
    allGroups: pair.groups === "all",
    groupIds: Array.isArray(pair.groups) ? pair.groups : [],
    studentsWhoSubmitted: pair.groups === "submitted",
    expiresAt: null,
  };
}

/** Keeps only the pairs whose exam side covers this exam (for "students of exam X" lists). */
export function reachForExam(reach: Reach, exam: { id: string; categoryId: string; tagIds: string[] }): Reach {
  if (reach.kind === "everything") return reach;
  return {
    kind: "pairs",
    pairs: reach.pairs.filter((pair) =>
      coversExam(asGrant(pair), { examId: exam.id, categoryId: exam.categoryId, tagIds: exam.tagIds }),
    ),
  };
}

/** Pure evaluation of a Reach — mirrors the Prisma filters below; used to cross-check against authorize(). */
export function reachAllows(reach: Reach, scope: Scope): boolean {
  if (reach.kind === "everything") return true;
  return reach.pairs.some((pair) => coversExam(asGrant(pair), scope) && coversStudents(asGrant(pair), scope));
}

const NOTHING = { id: { in: [] as string[] } };

/** The exams one pair's exam side covers (never "all": callers short-circuit that). */
function examSideWhere(side: Exclude<ExamSide, "all">): Prisma.ExamWhereInput[] {
  return [
    ...(side.examIds.length ? [{ id: { in: side.examIds } }] : []),
    ...(side.categoryIds.length ? [{ categoryId: { in: side.categoryIds } }] : []),
    ...(side.tagIds.length ? [{ tags: { some: { tagId: { in: side.tagIds } } } }] : []),
  ];
}

/** Exams the principal can reach (student side ignored: seeing an exam does not depend on students). */
export function examWhere(reach: Reach): Prisma.ExamWhereInput {
  if (reach.kind === "everything" || reach.pairs.some((p) => p.exams === "all")) return {};
  const or = reach.pairs.flatMap((p) => (p.exams === "all" ? [] : examSideWhere(p.exams)));
  return or.length ? { OR: or } : NOTHING;
}

/** Groups the principal can reach. "Students who submitted" grants reach no group. */
export function groupWhere(reach: Reach): Prisma.GroupWhereInput {
  const groups = groupSide(reach);
  if (groups === "all") return {};
  return groups.length ? { id: { in: groups } } : NOTHING;
}

/**
 * Students the principal can reach, per grant: everyone (all groups), members of a listed group
 * (D6), or students with a submitted attempt on an exam that same grant covers.
 */
export function studentWhere(reach: Reach): Prisma.UserWhereInput {
  if (reach.kind === "everything" || reach.pairs.some((p) => p.groups === "all")) return { role: "STUDENT" };
  const or: Prisma.UserWhereInput[] = reach.pairs.flatMap((p): Prisma.UserWhereInput[] => {
    if (p.groups === "submitted") {
      const exam: Prisma.ExamWhereInput = p.exams === "all" ? {} : { OR: examSideWhere(p.exams) };
      if (p.exams !== "all" && !examSideWhere(p.exams).length) return [];
      return [{ attempts: { some: { status: { in: SUBMITTED_STATUSES }, exam } } }];
    }
    return Array.isArray(p.groups) && p.groups.length ? [{ memberships: { some: { groupId: { in: p.groups } } } }] : [];
  });
  return or.length ? { role: "STUDENT", OR: or } : NOTHING;
}

function groupSide(reach: Reach): "all" | string[] {
  if (reach.kind === "everything" || reach.pairs.some((p) => p.groups === "all")) return "all";
  return [...new Set(reach.pairs.flatMap((p) => (Array.isArray(p.groups) ? p.groups : [])))];
}

/**
 * Assignments / overrides whose target is reachable: a reachable group, or a reachable student.
 * Combine with reachForExam(...) so the exam side of each grant is respected.
 */
export function targetWhere(reach: Reach) {
  if (groupSide(reach) === "all") return {};
  return { OR: [{ group: { is: groupWhere(reach) } }, { user: { is: studentWhere(reach) } }] };
}

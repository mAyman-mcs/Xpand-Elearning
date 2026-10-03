import type { DbClient } from "../../core/db.js";
import type { AssignmentInput, AttemptInput, OverrideInput, StudentInput } from "./availability.js";

// Loads resolver inputs from the database, batched for many students × many exams.

export async function loadStudents(db: DbClient, userIds: string[]): Promise<Map<string, StudentInput>> {
  const rows = await db.user.findMany({
    where: { id: { in: userIds }, role: "STUDENT" },
    select: {
      id: true,
      joinDate: true,
      memberships: { select: { groupId: true, joinDate: true, group: { select: { intakeStartDate: true } } } },
    },
  });
  return new Map(
    rows.map((u) => [
      u.id,
      {
        id: u.id,
        joinDate: u.joinDate,
        memberships: u.memberships.map((m) => ({
          groupId: m.groupId,
          joinDate: m.joinDate,
          intakeStartDate: m.group.intakeStartDate,
        })),
      },
    ]),
  );
}

export interface ExamRules {
  assignments: (AssignmentInput & { examId: string })[];
  overrides: (OverrideInput & { examId: string })[];
  attempts: (AttemptInput & { examId: string; userId: string })[];
}

/** Everything that decides availability for these students on these exams. */
export async function loadExamRules(db: DbClient, examIds: string[], students: StudentInput[]): Promise<ExamRules> {
  const userIds = students.map((s) => s.id);
  const groupIds = [...new Set(students.flatMap((s) => s.memberships.map((m) => m.groupId)))];
  const target = { OR: [{ userId: { in: userIds } }, { groupId: { in: groupIds } }] };

  const [assignments, overrides, attempts] = await Promise.all([
    db.assignment.findMany({ where: { examId: { in: examIds }, ...target } }),
    db.accessOverride.findMany({ where: { examId: { in: examIds }, ...target } }),
    db.attempt.findMany({
      where: { examId: { in: examIds }, userId: { in: userIds } },
      select: { examId: true, userId: true, status: true, reviewStatus: true, attemptNo: true },
    }),
  ]);
  return { assignments, overrides, attempts };
}

/** The slice of the rules for one exam and one student (the resolver filters targets itself). */
export function rulesFor(rules: ExamRules, examId: string, userId: string) {
  return {
    assignments: rules.assignments.filter((a) => a.examId === examId),
    overrides: rules.overrides.filter((o) => o.examId === examId),
    attempts: rules.attempts.filter((a) => a.examId === examId && a.userId === userId),
  };
}

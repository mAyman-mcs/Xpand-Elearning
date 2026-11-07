import type { GradingAttempt, GradingQuestion } from "@contracts";
import type { GradeInput } from "./api";

// The grade-attempt page's draft, and the server's grading rules (grading/rules.ts) for instant
// feedback. The server checks again and has the final word.

/** What the grader has typed for one question (strings: inputs can be empty mid-edit). */
export interface Draft {
  points: string;
  feedback: string;
  reason: string;
}

const isChoice = (q: GradingQuestion) => q.type !== "ESSAY";

/** The points the server currently counts for a question (null: an essay not graded yet). */
export function serverPoints(q: GradingQuestion): number | null {
  return isChoice(q) ? (q.awardedPoints ?? q.autoPoints ?? 0) : q.awardedPoints;
}

export function draftsOf(a: GradingAttempt): Record<string, Draft> {
  return Object.fromEntries(
    a.questions.map((q) => {
      const points = serverPoints(q);
      return [
        q.id,
        { points: points === null ? "" : String(points), feedback: q.feedback ?? "", reason: q.overrideReason ?? "" },
      ];
    }),
  );
}

/** Does this choice question's draft differ from its automatic points (an override)? */
export const isOverride = (q: GradingQuestion, d: Draft) =>
  isChoice(q) && d.points !== "" && Number(d.points) !== (q.autoPoints ?? 0);

/** Why one question's draft would be refused (null = fine; empty essay points are "not graded yet"). */
export function draftProblem(q: GradingQuestion, d: Draft): string | null {
  if (d.points === "") return null;
  const points = Number(d.points);
  if (!(points >= 0) || points > q.points) return `Give between 0 and ${q.points} points.`;
  if (points !== q.points && !Number.isInteger(points * 2)) return "Give points in steps of 0.5.";
  if (q.type === "ESSAY" && !q.answered && points !== 0) return "Not answered: it can only get 0 points.";
  if (isOverride(q, d) && !d.reason.trim()) return "Changing the automatic points needs a reason.";
  return null;
}

/** The grades that differ from what the server has (only those are sent). */
export function changedGrades(a: GradingAttempt, drafts: Record<string, Draft>): GradeInput[] {
  return a.questions.flatMap((q) => {
    const d = drafts[q.id];
    if (!d || d.points === "") return [];
    const points = Number(d.points);
    const feedback = d.feedback.trim();
    const reason = d.reason.trim();
    const changed =
      points !== serverPoints(q) ||
      feedback !== (q.feedback ?? "") ||
      (isOverride(q, d) && reason !== (q.overrideReason ?? ""));
    if (!changed) return [];
    return [{ questionId: q.id, points, feedback: feedback || null, ...(isOverride(q, d) ? { reason } : {}) }];
  });
}

/** What blocks approval with this draft (the server's approvalProblems, plus invalid entries). */
export function draftProblems(a: GradingAttempt, drafts: Record<string, Draft>): string[] {
  const problems: string[] = [];
  const missing: number[] = [];
  a.questions.forEach((q, i) => {
    const d = drafts[q.id];
    if (!d) return;
    const problem = draftProblem(q, d);
    if (problem) problems.push(`Question ${i + 1}: ${problem}`);
    else if (q.type === "ESSAY" && q.answered && d.points === "") missing.push(i + 1);
  });
  if (missing.length)
    problems.unshift(`Give points for question${missing.length > 1 ? "s" : ""} ${missing.join(", ")}.`);
  return problems;
}

/** The score this draft would give, rounded to cents. */
export function draftTotal(a: GradingAttempt, drafts: Record<string, Draft>): number {
  const total = a.questions.reduce((sum, q) => {
    const d = drafts[q.id];
    const points = d && d.points !== "" ? Number(d.points) : (serverPoints(q) ?? 0);
    return sum + (Number.isFinite(points) ? points : 0);
  }, 0);
  return Math.round(total * 100) / 100;
}

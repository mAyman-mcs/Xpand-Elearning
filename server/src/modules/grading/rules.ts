// Pure rules of manual grading (docs/EXAM_TYPES_PLAN.md §3.4). No database: the service loads the
// inputs, tests feed plain data.
import type { QuestionType } from "../../generated/prisma/enums.js";

export interface GradedQuestion {
  id: string;
  type: QuestionType;
  /** The question's maximum. */
  points: number;
}

export interface GradedAnswer {
  /** The student wrote something (essays) or selected something (choices). */
  answered: boolean;
  autoPoints: number | null;
  awardedPoints: number | null;
}

/** Points are given in steps of half a point (T7); the question's own maximum is always allowed. */
const onStep = (points: number, max: number) => points === max || Number.isInteger(points * 2);

/**
 * Why a grader's points for one question are refused (null = accepted). An override of a choice
 * question's automatic points needs a reason (T5).
 */
export function gradeProblem(
  question: Pick<GradedQuestion, "type" | "points">,
  points: number,
  autoPoints: number | null,
  reason: string | undefined,
): string | null {
  if (!(points >= 0) || points > question.points) return `Give between 0 and ${question.points} points.`;
  if (!onStep(points, question.points)) return "Give points in steps of 0.5.";
  if (question.type !== "ESSAY" && points !== (autoPoints ?? 0) && !reason?.trim())
    return "Changing the automatic points of a multiple-choice question needs a reason.";
  return null;
}

/**
 * What still blocks approval, in words (empty = it can be approved). Every answered essay needs
 * points; an unanswered essay counts as 0 without grading.
 */
export function approvalProblems(questions: GradedQuestion[], answers: Map<string, GradedAnswer>): string[] {
  const missing = questions
    .map((q, i) => ({ q, n: i + 1, a: answers.get(q.id) }))
    .filter(({ q, a }) => q.type === "ESSAY" && a?.answered && a.awardedPoints === null);
  return missing.length
    ? [`Give points for question${missing.length > 1 ? "s" : ""} ${missing.map((m) => m.n).join(", ")}.`]
    : [];
}

/** The score on approval: the grader's points, else the automatic points, else 0 — rounded to cents. */
export function finalScore(questions: GradedQuestion[], answers: Map<string, GradedAnswer>): number {
  const total = questions.reduce((sum, q) => {
    const a = answers.get(q.id);
    return sum + (a?.awardedPoints ?? a?.autoPoints ?? 0);
  }, 0);
  return Math.round(total * 100) / 100;
}

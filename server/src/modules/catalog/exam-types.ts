// Exam types and scoring modes (docs/EXAM_TYPES_PLAN.md). Pure rules, shared by the catalog,
// the exam session and grading.
import type { ExamType, QuestionType, ScoringMode } from "../../generated/prisma/enums.js";

/** Question types graded automatically from the selected options. */
export const CHOICE_TYPES: readonly QuestionType[] = ["SINGLE_CHOICE", "MULTI_CHOICE", "TRUE_FALSE"];

export const isChoice = (type: QuestionType) => CHOICE_TYPES.includes(type);

/** Longest essay answer accepted, in characters (T6; also a CHECK constraint). */
export const ESSAY_MAX_CHARS = 10_000;

/** The scoring mode used when none is chosen: essays always need approval, MCQ is auto scored. */
export const defaultScoringMode = (type: ExamType): ScoringMode => (type === "MCQ_ESSAY" ? "MANUAL_APPROVAL" : "AUTO");

/** Why this type / scoring combination is not allowed (null = allowed). */
export function scoringProblem(type: ExamType, scoringMode: ScoringMode): string | null {
  return type === "MCQ_ESSAY" && scoringMode === "AUTO"
    ? "Exams with essay questions can't be auto scored: choose “Needs approval”."
    : null;
}

/** May an exam of this type contain a question of that type? */
export const questionAllowed = (examType: ExamType, questionType: QuestionType) =>
  questionType !== "ESSAY" || examType === "MCQ_ESSAY";

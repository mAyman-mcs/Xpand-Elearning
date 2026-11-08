import type { AnswerSize, ExamType, QuestionType, StaffCase, StaffQuestion } from "@contracts";
import type { QuestionInput } from "./api";

// The server's question rules (catalog/content.service.ts questionProblems), for instant feedback
// in the editor. The server checks again and has the final word.

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Single choice",
  MULTI_CHOICE: "Multiple choice",
  TRUE_FALSE: "True / false",
  ESSAY: "Essay",
};

/** The question types an exam of this type may contain. */
export const questionTypesFor = (examType: ExamType): QuestionType[] =>
  examType === "MCQ_ESSAY"
    ? ["SINGLE_CHOICE", "MULTI_CHOICE", "TRUE_FALSE", "ESSAY"]
    : ["SINGLE_CHOICE", "MULTI_CHOICE", "TRUE_FALSE"];

export const ANSWER_SIZE_LABEL: Record<AnswerSize, string> = {
  SHORT: "Short answer (one line)",
  LONG: "Long answer (text area)",
};

/** Suggested case labels, as on the printed use cases. */
export const CASE_LABELS = ["KNOWLEDGE", "FILL IN", "DESIGN", "TROUBLESHOOT"];

/** The server's limit for a SHORT written answer. */
export const SHORT_ANSWER_MAX_CHARS = 300;

/** Where an uploaded picture is served (staff, or students during an attempt). */
export const uploadUrl = (id: string) => `/api/uploads/${id}`;

/** A, B, C… for the option at this position (cases keep their option order, so letters are stable). */
export const optionLetter = (i: number) => String.fromCharCode(65 + i);

export function questionProblems(
  q: Pick<QuestionInput, "type" | "text" | "points" | "options" | "imageId" | "imageAlt">,
): string[] {
  const problems: string[] = [];
  const correct = q.options.filter((o) => o.isCorrect).length;
  if (!q.text.trim()) problems.push("The question has no text.");
  if (!(q.points > 0)) problems.push("Points must be more than 0.");
  if (q.imageId && !q.imageAlt?.trim()) problems.push("Describe the question's picture (alt text).");
  if (q.type === "ESSAY") {
    if (q.options.length) problems.push("Essay questions have no options.");
    return problems;
  }
  if (q.options.some((o) => !o.text.trim() && !o.imageId)) problems.push("An option has no text or picture.");
  if (q.options.some((o) => o.imageId && !o.imageAlt?.trim()))
    problems.push("Describe every option picture (alt text).");
  if (q.type === "TRUE_FALSE") {
    if (q.options.length !== 2) problems.push("True/false questions have exactly 2 options.");
    if (correct !== 1) problems.push("Mark exactly one option as correct.");
  } else {
    if (q.options.length < 2 || q.options.length > 10) problems.push("Give between 2 and 10 options.");
    if (q.type === "SINGLE_CHOICE" && correct !== 1) problems.push("Mark exactly one option as correct.");
    if (q.type === "MULTI_CHOICE" && correct < 1) problems.push("Mark at least one option as correct.");
  }
  return problems;
}

/** Switching type keeps what still fits: true/false gets its two fixed options; single keeps one correct. */
export function changeType(q: QuestionInput, type: QuestionType): QuestionInput {
  if (type === "ESSAY") return { ...q, type, options: [] };
  // From an essay: start again from blank options (and drop the grader guidance).
  if (q.type === "ESSAY") q = { ...q, guidance: null, options: NEW_QUESTION.options };
  if (type === "TRUE_FALSE") {
    const trueCorrect = q.type === "TRUE_FALSE" ? (q.options[0]?.isCorrect ?? true) : true;
    return {
      ...q,
      type,
      options: [
        { text: "True", isCorrect: trueCorrect },
        { text: "False", isCorrect: !trueCorrect },
      ],
    };
  }
  if (type === "SINGLE_CHOICE") {
    const first = q.options.findIndex((o) => o.isCorrect);
    return { ...q, type, options: q.options.map((o, i) => ({ ...o, isCorrect: i === first })) };
  }
  return { ...q, type };
}

/**
 * Delivery blocks: consecutive questions of the same case form one block; any other question is a
 * block of its own. Used by the editor, the exam session and grading.
 */
export function blocksOf<Q extends { caseId: string | null }>(questions: readonly Q[]): Q[][] {
  const blocks: Q[][] = [];
  for (const q of questions) {
    const last = blocks.at(-1);
    if (q.caseId && last?.[0]?.caseId === q.caseId) last.push(q);
    else blocks.push([q]);
  }
  return blocks;
}

export interface ContentBlock {
  /** null: a question on its own. */
  case: StaffCase | null;
  questions: StaffQuestion[];
}

/** The exam's content as the editor shows it: blocks in order, then cases that have no questions yet. */
export function contentBlocks(questions: StaffQuestion[], cases: StaffCase[]): ContentBlock[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const blocks: ContentBlock[] = blocksOf(questions).map((qs) => ({
    case: qs[0]?.caseId ? (byId.get(qs[0].caseId) ?? null) : null,
    questions: qs,
  }));
  const placed = new Set(questions.map((q) => q.caseId));
  for (const c of cases) if (!placed.has(c.id)) blocks.push({ case: c, questions: [] });
  return blocks;
}

/** The question order after swapping block `index` with its neighbour (`by` = -1 up, 1 down). */
export function moveBlock(blocks: ContentBlock[], index: number, by: -1 | 1): string[] | null {
  const placed = blocks.filter((b) => b.questions.length > 0);
  const target = index + by;
  if (index < 0 || target < 0 || target >= placed.length) return null;
  const next = [...placed];
  [next[index], next[target]] = [next[target] as ContentBlock, next[index] as ContentBlock];
  return next.flatMap((b) => b.questions.map((q) => q.id));
}

export const NEW_QUESTION: QuestionInput = {
  type: "SINGLE_CHOICE",
  text: "",
  imageUrl: null,
  imageId: null,
  imageAlt: null,
  points: 1,
  guidance: null,
  answerSize: "LONG",
  caseId: null,
  options: [
    { text: "", isCorrect: true },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
  ],
};

/** The JSON format accepted by "Import questions" (shown on the page as an example). */
export const IMPORT_EXAMPLE = JSON.stringify(
  {
    questions: [
      {
        type: "SINGLE_CHOICE",
        text: "Which port does HTTPS use by default?",
        points: 1,
        options: [
          { text: "443", isCorrect: true },
          { text: "80", isCorrect: false },
          { text: "22", isCorrect: false },
        ],
      },
      {
        type: "TRUE_FALSE",
        text: "A /24 network has 256 addresses.",
        options: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
        ],
      },
    ],
    cases: [
      {
        label: "FILL IN",
        title: "Linux file permissions",
        situation: "ls -la shows: -rw-r----- 1 root www-data 2048 config.php",
        questions: [
          {
            type: "SINGLE_CHOICE",
            points: 2,
            text: "What are the permissions for Owner, Group and Others?",
            options: [
              { text: "Owner: rwx | Group: r-x | Others: r--", isCorrect: false },
              {
                text: "Owner: rw- | Group: r-- | Others: ---",
                isCorrect: true,
                explanation: "Read 3 by 3 after the type",
              },
            ],
          },
          {
            type: "ESSAY",
            answerSize: "SHORT",
            text: "Which chmod command sets 640?",
            guidance: "chmod 640 config.php",
          },
        ],
      },
    ],
  },
  null,
  2,
);

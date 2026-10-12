import type { QuestionType } from "@contracts";
import type { QuestionInput } from "./api";

// The server's question rules (catalog/content.service.ts questionProblems), for instant feedback
// in the editor. The server checks again and has the final word.

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Single choice",
  MULTI_CHOICE: "Multiple choice",
  TRUE_FALSE: "True / false",
};

export function questionProblems(q: Pick<QuestionInput, "type" | "text" | "points" | "options">): string[] {
  const problems: string[] = [];
  const correct = q.options.filter((o) => o.isCorrect).length;
  if (!q.text.trim()) problems.push("The question has no text.");
  if (!(q.points > 0)) problems.push("Points must be more than 0.");
  if (q.options.some((o) => !o.text.trim())) problems.push("An option has no text.");
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

export const NEW_QUESTION: QuestionInput = {
  type: "SINGLE_CHOICE",
  text: "",
  imageUrl: null,
  points: 1,
  options: [
    { text: "", isCorrect: true },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
    { text: "", isCorrect: false },
  ],
};

/** The JSON format accepted by "Import questions" (shown on the page as an example). */
export const IMPORT_EXAMPLE = JSON.stringify(
  [
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
  null,
  2,
);

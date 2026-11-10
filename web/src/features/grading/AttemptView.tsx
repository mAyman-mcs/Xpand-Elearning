import type { GradingQuestion, StudentCase } from "@contracts";
import type { ReactNode } from "react";
import { Picture } from "../../components/Picture";
import { Badge, cx } from "../../components/ui";
import { blocksOf, optionLetter, QUESTION_TYPE_LABEL } from "../../lib/questions";

// How staff see a finished attempt, shared by the grading page and the read-only preview: the
// questions in delivery order, each case once around its questions, and the student's answers.

/** The questions, grouped by case. `card` renders one question (with or without grading controls). */
export function AttemptBlocks({
  questions,
  cases,
  card,
}: {
  questions: GradingQuestion[];
  cases: StudentCase[];
  card: (q: GradingQuestion) => ReactNode;
}) {
  return (
    <ol className="space-y-4" aria-label="Questions">
      {blocksOf(questions).map((block) => {
        const c = block[0]?.caseId ? cases.find((x) => x.id === block[0]?.caseId) : undefined;
        const cards = block.map(card);
        if (!c) return <li key={block[0]!.id}>{cards}</li>;
        return (
          <li key={c.id} className="rounded-xl border border-teal-200 bg-teal-50/40 p-3 sm:p-4">
            <section aria-label={`Case: ${c.title}`} className="space-y-4">
              <div>
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <Badge tone="teal">Case</Badge>
                  {c.label && <Badge>{c.label}</Badge>}
                  <span>
                    Questions {block[0]!.index + 1}–{block.at(-1)!.index + 1}
                  </span>
                </p>
                <h2 className="font-bold text-slate-800">{c.title}</h2>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{c.situation}</p>
                {c.hint && (
                  <p className="mt-1 text-sm text-amber-800">
                    <span className="font-semibold">Hint:</span> {c.hint}
                  </p>
                )}
                {c.imageUrl && <Picture src={c.imageUrl} alt={c.imageAlt} className="mt-2 max-h-48" />}
              </div>
              {cards}
            </section>
          </li>
        );
      })}
    </ol>
  );
}

/** One question with the answer key and the student's answer (no points). */
export function QuestionBody({ q }: { q: GradingQuestion }) {
  return (
    <>
      <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-bold text-slate-700">Q{q.index + 1}</span>
        <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
        <span>
          {q.points} point{q.points === 1 ? "" : "s"}
        </span>
      </p>
      <p className="font-medium whitespace-pre-wrap text-slate-800">{q.text}</p>
      {q.imageUrl && <Picture src={q.imageUrl} alt={q.imageAlt} className="mt-2 max-h-40" />}

      {q.type === "ESSAY" ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="mb-1 text-xs font-semibold text-slate-600 uppercase">Student's answer</p>
            {q.answered ? (
              // Plain text only: the answer is never rendered as HTML.
              <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-800">
                {q.answerText}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600">
                Not answered: counts as 0 points.
              </p>
            )}
          </div>
          {q.guidance && (
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600 uppercase">Model answer / guidance</p>
              <p className="rounded-lg bg-sky-50 p-3 text-sm whitespace-pre-wrap text-sky-900">{q.guidance}</p>
            </div>
          )}
        </div>
      ) : (
        <ul
          className={cx("mt-3 text-sm", q.options.some((o) => o.imageUrl) ? "grid gap-2 sm:grid-cols-2" : "space-y-1")}
        >
          {q.options.map((o, i) => (
            <li
              key={o.id}
              className={cx(
                "rounded px-2 py-1",
                o.selected && (o.isCorrect ? "bg-emerald-50" : "bg-red-50"),
                o.imageUrl && "border border-slate-200",
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className={o.isCorrect ? "font-semibold text-emerald-700" : "text-slate-700"}>
                  {o.isCorrect ? "✓" : "○"} {optionLetter(i)}. {o.text}
                </span>
                {o.isCorrect && <span className="sr-only">(correct)</span>}
                {o.selected && <Badge tone={o.isCorrect ? "green" : "red"}>Student's choice</Badge>}
              </span>
              {o.imageUrl && <Picture src={o.imageUrl} alt={o.imageAlt} className="mt-1 max-h-40" />}
              {o.detail && <span className="block text-xs text-slate-600 italic">{o.detail}</span>}
              {o.explanation && <span className="block text-xs text-sky-800">Explanation: {o.explanation}</span>}
            </li>
          ))}
          {!q.answered && <li className="text-slate-600">Not answered.</li>}
        </ul>
      )}
    </>
  );
}

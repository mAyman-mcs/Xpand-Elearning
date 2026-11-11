import type { StudentQuestion } from "@contracts";
import { useState } from "react";
import { cx } from "../../components/ui";

export type ScreenState = "current" | "answered" | "unanswered" | "locked" | "ahead";

/**
 * One screen's state on the map. In an exam without going back, screens already passed are locked
 * and screens not reached yet are shown but can't be opened, so the student still sees what is left.
 */
export function screenState(o: {
  here: boolean;
  answered: boolean;
  allowBack: boolean;
  /** The screen's first question index. */
  first: number;
  /** The current screen's first question index. */
  currentFirst: number;
}): ScreenState {
  if (o.here) return "current";
  if (!o.allowBack) return o.first < o.currentFirst ? "locked" : "ahead";
  return o.answered ? "answered" : "unanswered";
}

const LABEL: Record<ScreenState, string> = {
  current: "current",
  answered: "answered",
  unanswered: "not answered",
  locked: "locked",
  ahead: "not reached yet",
};

const STYLE: Record<ScreenState, string> = {
  current: "bg-brand-700 text-white ring-2 ring-brand-700 ring-offset-1",
  answered: "bg-brand-50 text-brand-900 ring-1 ring-brand-300",
  unanswered: "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
  locked: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  ahead: "border border-dashed border-slate-300 bg-white text-slate-500",
};

/** A small mark beside the number, so the state doesn't rely on colour alone. */
function Mark({ state }: { state: ScreenState }) {
  if (state === "answered")
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === "locked")
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
        <path d="M5 7V5a3 3 0 0 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-5A1.5 1.5 0 0 1 4.5 7H5zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2z" />
      </svg>
    );
  return null;
}

interface Props {
  blocks: StudentQuestion[][];
  current: StudentQuestion[];
  allowBack: boolean;
  isAnswered: (q: StudentQuestion) => boolean;
  onOpen: (firstIndex: number) => void;
}

/** Every screen of the exam as a button: where you are, what is done, what is left. */
export function QuestionMap({ blocks, current, allowBack, isAnswered, onOpen }: Props) {
  // On small screens the map folds behind a button, so the question stays in view.
  const [open, setOpen] = useState(false);
  const currentFirst = current[0]?.index ?? 0;

  return (
    <div className="mb-4">
      <button
        type="button"
        className="mb-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 sm:hidden"
        aria-expanded={open}
        aria-controls="question-map"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide questions" : "Show questions"}
      </button>
      <nav
        id="question-map"
        aria-label="Questions"
        className={cx("flex-wrap gap-1.5 sm:flex", open ? "flex" : "hidden")}
      >
        {blocks.map((b) => {
          const first = b[0]!;
          const last = b.at(-1)!;
          const state = screenState({
            here: b === current,
            answered: b.every(isAnswered),
            allowBack,
            first: first.index,
            currentFirst,
          });
          const range = b.length > 1 ? `${first.index + 1}–${last.index + 1}` : `${first.index + 1}`;
          const clickable = state === "answered" || state === "unanswered";
          return (
            <button
              key={first.id}
              type="button"
              disabled={!clickable && state !== "current"}
              onClick={() => clickable && onOpen(first.index)}
              aria-current={state === "current" ? "step" : undefined}
              aria-label={`${b.length > 1 ? "Questions" : "Question"} ${range}, ${LABEL[state]}`}
              className={cx(
                "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-semibold disabled:cursor-not-allowed",
                STYLE[state],
              )}
            >
              {range}
              <Mark state={state} />
            </button>
          );
        })}
      </nav>
    </div>
  );
}

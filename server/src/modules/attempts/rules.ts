// Pure rules of the exam session (docs/NEXT_PLAN.md §3–4, decisions E2, E6–E9). No database: the
// service loads the inputs, tests feed plain data.
import type { QuestionType, ViolationType } from "../../generated/prisma/enums.js";

// ─────────────────────────────── Time ───────────────────────────────

/** Late saves are accepted this long after the deadline (network delay, E8). */
export const GRACE_MS = 5_000;

/**
 * When the attempt ends (E7): the exam's duration (plus any extra time), but never after the window
 * closes — a student starting 5 minutes before the close gets 5 minutes. An open-ended window (or a
 * manual opening without an end) gives the full duration.
 */
export function deadlineFor(
  startedAt: Date,
  durationMinutes: number,
  extraMinutes: number,
  windowClosesAt: Date | null,
): Date {
  const byDuration = startedAt.getTime() + (durationMinutes + extraMinutes) * 60_000;
  return new Date(windowClosesAt ? Math.min(byDuration, windowClosesAt.getTime()) : byDuration);
}

/** Answers are accepted until the deadline plus the grace period. */
export const acceptsAnswers = (deadlineAt: Date, now: Date) => now.getTime() <= deadlineAt.getTime() + GRACE_MS;

/** Past the grace period: the attempt must be finalized (lazily, or by the sweeper). */
export const isOverdue = (deadlineAt: Date, now: Date) => !acceptsAnswers(deadlineAt, now);

// ─────────────────────────────── Order ───────────────────────────────

/** Fisher–Yates with an injected random source (crypto in production, seeded in tests). */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    // A source outside [0, 1) (or NaN) must not lose an element: such a draw keeps the item in place.
    const r = random();
    const j = r >= 0 && r < 1 ? Math.floor(r * (i + 1)) : i;
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** The attempt's question order and per-question option order, fixed at start (EXAM-6). */
export function deliveryOrder(
  questions: { id: string; options: { id: string }[] }[],
  settings: { shuffleQuestions: boolean; shuffleOptions: boolean },
  random: () => number,
): { questionOrder: string[]; optionOrder: Record<string, string[]> } {
  const ordered = settings.shuffleQuestions ? shuffled(questions, random) : questions;
  return {
    questionOrder: ordered.map((q) => q.id),
    optionOrder: Object.fromEntries(
      ordered.map((q) => {
        const ids = q.options.map((o) => o.id);
        return [q.id, settings.shuffleOptions ? shuffled(ids, random) : ids];
      }),
    ),
  };
}

// ─────────────────────────────── Answers and grading ───────────────────────────────

/** Is this selection allowed for the question? (Options must be its own; one at most unless multi.) */
export function validSelection(type: QuestionType, optionIds: string[], selected: string[]): boolean {
  if (new Set(selected).size !== selected.length) return false;
  if (!selected.every((id) => optionIds.includes(id))) return false;
  return type === "MULTI_CHOICE" || selected.length <= 1;
}

export interface GradeQuestion {
  id: string;
  points: number;
  correctOptionIds: string[];
}

/**
 * Exact match per question, all or nothing (E2): full points only when exactly the correct options
 * are selected. Unanswered = 0. The maximum is over the questions delivered in this attempt.
 */
export function grade(questions: GradeQuestion[], answers: Map<string, string[]>) {
  const perQuestion = questions.map((q) => {
    const selected = new Set(answers.get(q.id) ?? []);
    const correct = selected.size === q.correctOptionIds.length && q.correctOptionIds.every((id) => selected.has(id));
    return { questionId: q.id, correct, points: correct ? q.points : 0 };
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    score: round(perQuestion.reduce((sum, q) => sum + q.points, 0)),
    maxScore: round(questions.reduce((sum, q) => sum + q.points, 0)),
    perQuestion,
  };
}

// ─────────────────────────────── Strikes ───────────────────────────────

/** Signals that count as strikes (E9); blocked actions and unreliable detections are only logged. */
export const STRIKE_TYPES: ReadonlySet<ViolationType> = new Set([
  "FULLSCREEN_EXIT",
  "TAB_HIDDEN",
  "WINDOW_BLUR",
  "RESIZE",
  "DEVICE_CHANGE",
]);

/** What the browser may report (the others are recorded by the server itself). */
export const CLIENT_EVENT_TYPES = [
  "FULLSCREEN_EXIT",
  "TAB_HIDDEN",
  "WINDOW_BLUR",
  "RESIZE",
  "CLIPBOARD",
  "CONTEXT_MENU",
  "BLOCKED_SHORTCUT",
  "DEVTOOLS",
] as const satisfies readonly ViolationType[];

/** Signals within this window count as one action (one Alt+Tab fires blur, hidden and fullscreen exit). */
export const MERGE_MS = 3_000;

export interface StrikeState {
  strikes: number;
  strikeMergedUntil: Date | null;
  strikeLimit: number;
}

export type EventAction = "WARN" | "AUTO_SUBMITTED" | "LOGGED";

/** The effect of one signal: is it a (new) strike, the new state, and what the browser must do. */
export function applyEvent(state: StrikeState, type: ViolationType, now: Date) {
  const strikeType = STRIKE_TYPES.has(type);
  const merged = strikeType && state.strikeMergedUntil !== null && now < state.strikeMergedUntil;
  const countsAsStrike = strikeType && !merged;
  const strikes = countsAsStrike ? state.strikes + 1 : state.strikes;
  const strikeMergedUntil = countsAsStrike ? new Date(now.getTime() + MERGE_MS) : state.strikeMergedUntil;
  const action: EventAction = !countsAsStrike ? "LOGGED" : strikes >= state.strikeLimit ? "AUTO_SUBMITTED" : "WARN";
  return { countsAsStrike, strikes, strikeMergedUntil, action };
}

/** A heartbeat older than this marks the student as disconnected (logged once per gap). */
export const HEARTBEAT_GAP_MS = 30_000;

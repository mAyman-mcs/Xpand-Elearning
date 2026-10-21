// Pure helpers of the exam session page (NEXT_PLAN F3). The server owns the clock and the strikes;
// these only display and classify.

/** How far the browser's clock is from the server's (ms to add to Date.now()). */
export const clockOffset = (serverNow: string, localNow = Date.now()) => Date.parse(serverNow) - localNow;

/** Milliseconds left before the deadline, by the server's clock; never negative. */
export function remainingMs(deadlineAt: string | null, offset: number, localNow = Date.now()): number | null {
  if (!deadlineAt) return null;
  return Math.max(0, Date.parse(deadlineAt) - (localNow + offset));
}

/** 1:05:09, 4:07, 0:09. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Under five minutes left: the timer turns red and is announced. */
export const LOW_TIME_MS = 5 * 60_000;

export type ClientEvent =
  | "FULLSCREEN_EXIT"
  | "TAB_HIDDEN"
  | "WINDOW_BLUR"
  | "RESIZE"
  | "CLIPBOARD"
  | "CONTEXT_MENU"
  | "BLOCKED_SHORTCUT"
  | "DEVTOOLS";

type Key = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/**
 * Keys blocked during the exam, and how they are reported: developer tools, copy/paste, print, save,
 * view source, select all, screenshots. Typing and navigation keys pass.
 */
export function blockedShortcut(e: Key): ClientEvent | null {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (key === "f12") return "DEVTOOLS";
  if (mod && (e.shiftKey || e.altKey) && ["i", "j", "c", "k"].includes(key)) return "DEVTOOLS";
  if (key === "printscreen") return "BLOCKED_SHORTCUT";
  if (mod && ["c", "x", "v", "a", "p", "s", "u"].includes(key)) return "BLOCKED_SHORTCUT";
  return null;
}

/** The window is "small" when it covers less than 85% of the screen (split screen, a second app). */
export const isShrunk = (inner: { width: number; height: number }, screen: { width: number; height: number }) =>
  inner.width < screen.width * 0.85 || inner.height < screen.height * 0.6;

/** Retry delays for a failed save: 1 s, 2 s, 4 s, then 8 s for good. */
export const retryDelay = (attempt: number) => Math.min(8_000, 1_000 * 2 ** attempt);

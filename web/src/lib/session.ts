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

/** Under five minutes left: the timer turns red. */
export const LOW_TIME_MS = 5 * 60_000;
/** Under ten minutes left: the timer turns amber. */
export const SOON_TIME_MS = 10 * 60_000;

/** The time-left warnings shown and announced: 10, 5 and 1 minute. */
export const TIME_WARNINGS_MS = [10 * 60_000, 5 * 60_000, 60_000] as const;

/**
 * The warning just crossed between two readings of the time left, if any. The first reading
 * (`previous` null) never warns, so a student resuming with 3 minutes left isn't told "10 minutes".
 */
export function crossedWarning(previous: number | null, left: number | null): number | null {
  if (previous === null || left === null) return null;
  const crossed = TIME_WARNINGS_MS.filter((t) => previous > t && left <= t);
  return crossed.length ? Math.min(...crossed) : null;
}

/** "10 minutes left", "1 minute left". */
export function warningText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

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
 * view source, select all, screenshots. Typing and navigation keys pass. In an essay box (`editing`),
 * select all only selects the student's own text, so it passes too; copy and paste stay blocked.
 */
export function blockedShortcut(e: Key, editing = false): ClientEvent | null {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (editing && mod && key === "a" && !e.shiftKey && !e.altKey) return null;
  if (key === "f12") return "DEVTOOLS";
  if (mod && (e.shiftKey || e.altKey) && ["i", "j", "c", "k"].includes(key)) return "DEVTOOLS";
  if (key === "printscreen") return "BLOCKED_SHORTCUT";
  if (mod && ["c", "x", "v", "a", "p", "s", "u"].includes(key)) return "BLOCKED_SHORTCUT";
  return null;
}

/** The window is "small" when it covers less than 85% of the screen (split screen, a second app). */
export const isShrunk = (inner: { width: number; height: number }, screen: { width: number; height: number }) =>
  inner.width < screen.width * 0.85 || inner.height < screen.height * 0.6;

/**
 * Why this device can't take the exam, if it can't. Phones and tablets ("touch": the main pointer is a
 * finger) are not supported: the on-screen keyboard shrinks the window, which would count as a
 * strike. "fullscreen": the exam needs fullscreen and the browser has none (iPhone Safari).
 */
export type DeviceProblem = "touch" | "fullscreen";

export interface DeviceInfo {
  /** The main pointer is coarse (a finger): matchMedia("(pointer: coarse)"). */
  touch: boolean;
  /** document.fullscreenEnabled. */
  fullscreenEnabled: boolean;
}

export function deviceProblem(device: DeviceInfo, requireFullscreen: boolean): DeviceProblem | null {
  if (device.touch) return "touch";
  if (requireFullscreen && !device.fullscreenEnabled) return "fullscreen";
  return null;
}

/** This browser's DeviceInfo. */
export function currentDevice(): DeviceInfo {
  return {
    touch: typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches,
    fullscreenEnabled: Boolean(document.fullscreenEnabled),
  };
}

/** Retry delays for a failed save: 1 s, 2 s, 4 s, then 8 s for good. */
export const retryDelay = (attempt: number) => Math.min(8_000, 1_000 * 2 ** attempt);

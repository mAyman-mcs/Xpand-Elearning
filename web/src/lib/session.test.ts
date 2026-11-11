import { describe, expect, it } from "vitest";
import {
  blockedShortcut,
  clockOffset,
  deviceProblem,
  formatCountdown,
  isShrunk,
  remainingMs,
  retryDelay,
} from "./session";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("the exam clock", () => {
  it("counts down by the server's clock, not the browser's", () => {
    // The browser is 2 minutes fast.
    const local = Date.parse("2026-10-18T10:02:00Z");
    const offset = clockOffset("2026-10-18T10:00:00Z", local);
    expect(offset).toBe(-120_000);
    expect(remainingMs("2026-10-18T10:30:00Z", offset, local)).toBe(30 * 60_000);
    expect(remainingMs("2026-10-18T10:30:00Z", offset, local + 31 * 60_000)).toBe(0);
    expect(remainingMs(null, offset, local)).toBeNull();
  });

  it("formats the countdown", () => {
    expect(formatCountdown(3_909_000)).toBe("1:05:09");
    expect(formatCountdown(247_000)).toBe("4:07");
    expect(formatCountdown(8_200)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
  });
});

describe("blocked keys", () => {
  it("blocks developer tools, copy/paste, print, save and screenshots", () => {
    expect(blockedShortcut(key("F12"))).toBe("DEVTOOLS");
    expect(blockedShortcut(key("I", { ctrlKey: true, shiftKey: true }))).toBe("DEVTOOLS");
    expect(blockedShortcut(key("i", { metaKey: true, altKey: true }))).toBe("DEVTOOLS");
    for (const k of ["c", "v", "x", "a", "p", "s", "u"])
      expect(blockedShortcut(key(k, { ctrlKey: true }))).toBe("BLOCKED_SHORTCUT");
    expect(blockedShortcut(key("PrintScreen"))).toBe("BLOCKED_SHORTCUT");
  });

  it("lets typing and navigation through", () => {
    for (const k of ["a", "c", "Tab", "ArrowDown", "Enter", " ", "Escape"]) expect(blockedShortcut(key(k))).toBeNull();
    expect(blockedShortcut(key("Tab", { shiftKey: true }))).toBeNull();
  });

  it("lets select all work inside an essay box, but never copy or paste", () => {
    expect(blockedShortcut(key("a", { ctrlKey: true }), true)).toBeNull();
    expect(blockedShortcut(key("a", { ctrlKey: true }))).toBe("BLOCKED_SHORTCUT");
    for (const k of ["c", "v", "x"]) expect(blockedShortcut(key(k, { ctrlKey: true }), true)).toBe("BLOCKED_SHORTCUT");
  });
});

describe("window size", () => {
  it("is shrunk below 85% of the screen's width or 60% of its height", () => {
    const screen = { width: 1920, height: 1040 };
    expect(isShrunk({ width: 1920, height: 940 }, screen)).toBe(false);
    expect(isShrunk({ width: 960, height: 1040 }, screen)).toBe(true);
    expect(isShrunk({ width: 1920, height: 500 }, screen)).toBe(true);
  });
});

describe("devices that can't take an exam", () => {
  it("accepts a laptop or desktop", () => {
    expect(deviceProblem({ touch: false, fullscreenEnabled: true }, true)).toBeNull();
  });

  it("refuses phones and tablets, fullscreen or not", () => {
    expect(deviceProblem({ touch: true, fullscreenEnabled: true }, false)).toBe("touch");
  });

  it("refuses a browser without fullscreen only when the exam needs it", () => {
    const noFullscreen = { touch: false, fullscreenEnabled: false };
    expect(deviceProblem(noFullscreen, true)).toBe("fullscreen");
    expect(deviceProblem(noFullscreen, false)).toBeNull();
  });
});

it("backs off 1, 2, 4, 8, 8 s", () => {
  expect([0, 1, 2, 3, 4].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 8000]);
});

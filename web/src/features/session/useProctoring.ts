import type { EventResult } from "@contracts";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { blockedShortcut, isShrunk, retryDelay, type ClientEvent } from "../../lib/session";

type Detail = Record<string, string | number | boolean>;
interface Queued {
  type: ClientEvent;
  detail?: Detail;
  clientTime: string;
}

interface Options {
  attemptId: string;
  /** Listening only while the attempt is in progress and the page is not ending it. */
  active: boolean;
  onResult: (result: EventResult) => void;
  onElsewhere: () => void;
}

/**
 * The browser side of the anti-cheating rules (NEXT_PLAN §4): it watches and reports, the server
 * decides what a signal costs. Reports are queued and retried, so a signal sent while offline still
 * arrives. Blocked actions (copy, paste, shortcuts, right-click, print) are stopped and reported.
 */
export function useProctoring({ attemptId, active, onResult, onElsewhere }: Options) {
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const callbacks = useRef({ onResult, onElsewhere });
  callbacks.current = { onResult, onElsewhere };
  const activeRef = useRef(active);
  activeRef.current = active;

  // ─── The queue: one report at a time, retried on network errors ───
  const queue = useRef<Queued[]>([]);
  const sending = useRef(false);
  const flush = useRef<() => Promise<void>>(async () => undefined);
  flush.current = async () => {
    if (sending.current) return;
    sending.current = true;
    let tries = 0;
    try {
      while (queue.current.length) {
        const next = queue.current[0] as Queued;
        try {
          const result = await api.attempts.event(attemptId, next);
          queue.current.shift();
          tries = 0;
          callbacks.current.onResult(result);
          if (result.action === "AUTO_SUBMITTED" || result.action === "ENDED") {
            queue.current = [];
            return;
          }
        } catch (e) {
          if (e instanceof ApiError && e.code === "ATTEMPT_IN_PROGRESS_ELSEWHERE") {
            queue.current = [];
            callbacks.current.onElsewhere();
            return;
          }
          // A 4xx won't change on retry: drop it. Network or server trouble: wait and retry.
          if (e instanceof ApiError && e.status < 500) queue.current.shift();
          else await new Promise((r) => setTimeout(r, retryDelay(tries++)));
        }
      }
    } finally {
      sending.current = false;
    }
  };

  useEffect(() => {
    if (!active) return;
    // A reload or closing the page fires "hidden" and "blur" too: that's leaving, not cheating (the
    // timer keeps running, and the server logs the heartbeat gap). Signals while leaving are ignored.
    let leaving = false;
    let leavingSince = 0;
    const onBeforeUnload = () => {
      leavingSince = Date.now();
    };
    const onPageHide = () => {
      leaving = true;
    };
    const onPageShow = () => {
      leaving = false;
    };
    // The "Leave site?" prompt itself takes focus away for a moment.
    const promptOpen = () => Date.now() - leavingSince < 5_000;

    const report = (type: ClientEvent, detail?: Detail) => {
      if (!activeRef.current || leaving) return;
      queue.current.push({ type, detail, clientTime: new Date().toISOString() });
      void flush.current();
    };

    const onFullscreen = () => {
      const on = Boolean(document.fullscreenElement);
      setFullscreen(on);
      if (!on) report("FULLSCREEN_EXIT");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report("TAB_HIDDEN");
    };
    // A blur is real only if focus doesn't come back at once (dialogs and alerts flicker it).
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(() => {
        if (!document.hasFocus() && !promptOpen()) report("WINDOW_BLUR");
      }, 300);
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let shrunk = isShrunk(
      { width: window.innerWidth, height: window.innerHeight },
      { width: screen.availWidth, height: screen.availHeight },
    );
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const inner = { width: window.innerWidth, height: window.innerHeight };
        const now = isShrunk(inner, { width: screen.availWidth, height: screen.availHeight });
        if (now && !shrunk) report("RESIZE", inner);
        shrunk = now;
      }, 500);
    };
    const onClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      report("CLIPBOARD", { action: e.type });
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      report("CONTEXT_MENU");
    };
    const onKey = (e: KeyboardEvent) => {
      const type = blockedShortcut(e);
      if (!type) return;
      e.preventDefault();
      report(type, {
        key: [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.shiftKey && "Shift", e.key].filter(Boolean).join("+"),
      });
    };
    const onPrint = () => report("BLOCKED_SHORTCUT", { action: "print" });
    const onDragStart = (e: DragEvent) => e.preventDefault();

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("dragstart", onDragStart);
    window.addEventListener("beforeprint", onPrint);
    return () => {
      clearTimeout(blurTimer);
      clearTimeout(resizeTimer);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("beforeprint", onPrint);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [active]);

  return { fullscreen };
}

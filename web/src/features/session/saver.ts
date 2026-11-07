import { ApiError } from "../../lib/api";
import { retryDelay } from "../../lib/session";

export type SaveState = "saving" | "saved" | "retrying" | "failed";

/** Why saving stopped for good: the attempt ended, or it is open on another device. */
export type SaveStop = "ended" | "elsewhere";

interface Options<T> {
  save: (questionId: string, value: T) => Promise<unknown>;
  onState: (questionId: string, state: SaveState, message?: string) => void;
  onStop: (reason: SaveStop) => void;
  /** Injected in tests. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Network errors and 5xx are worth retrying; a 4xx answer won't change. */
const transient = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;

/**
 * Autosave for the exam page. Per question, the latest answer wins: a change made while a save
 * is in flight is sent right after it, and older ones are dropped. Failed saves retry with backoff
 * until they succeed, so a short network drop loses nothing. `flush()` sends what is waiting
 * (including typing not yet sent by `setLater`) and waits for everything.
 */
export class AnswerSaver<T = string[]> {
  private pending = new Map<string, T>();
  private running = new Map<string, Promise<void>>();
  private later = new Map<string, { timer: ReturnType<typeof setTimeout>; value: T }>();
  private stopped = false;

  constructor(private readonly opts: Options<T>) {}

  set(questionId: string, value: T): void {
    if (this.stopped) return;
    const waiting = this.later.get(questionId);
    if (waiting) {
      clearTimeout(waiting.timer);
      this.later.delete(questionId);
    }
    this.pending.set(questionId, value);
    this.opts.onState(questionId, "saving");
    if (!this.running.has(questionId)) {
      const run = this.drain(questionId).finally(() => this.running.delete(questionId));
      this.running.set(questionId, run);
    }
  }

  /** Saves after `delayMs` without a newer value (typing): one request per pause, not per key. */
  setLater(questionId: string, value: T, delayMs: number): void {
    if (this.stopped) return;
    const waiting = this.later.get(questionId);
    if (waiting) clearTimeout(waiting.timer);
    const timer = setTimeout(() => this.set(questionId, value), delayMs);
    this.later.set(questionId, { timer, value });
  }

  /** Resolves once nothing is waiting or in flight (failed saves give up after `maxTries`). */
  async flush(): Promise<void> {
    for (const [questionId, { value }] of [...this.later]) this.set(questionId, value);
    while (this.running.size) await Promise.all([...this.running.values()]);
  }

  stop(): void {
    this.stopped = true;
    this.pending.clear();
    for (const { timer } of this.later.values()) clearTimeout(timer);
    this.later.clear();
  }

  private async drain(questionId: string, maxTries = 6): Promise<void> {
    const wait = this.opts.wait ?? sleep;
    let tries = 0;
    while (!this.stopped) {
      if (!this.pending.has(questionId)) return;
      const selected = this.pending.get(questionId) as T;
      this.pending.delete(questionId);
      try {
        await this.opts.save(questionId, selected);
        tries = 0;
        if (!this.pending.has(questionId)) this.opts.onState(questionId, "saved");
      } catch (e) {
        if (e instanceof ApiError && (e.code === "ATTEMPT_CLOSED" || e.code === "ATTEMPT_SUBMITTED")) {
          this.stop();
          this.opts.onStop("ended");
          return;
        }
        if (e instanceof ApiError && e.code === "ATTEMPT_IN_PROGRESS_ELSEWHERE") {
          this.stop();
          this.opts.onStop("elsewhere");
          return;
        }
        if (!transient(e) || tries >= maxTries) {
          this.opts.onState(questionId, "failed", e instanceof ApiError ? e.message : undefined);
          return;
        }
        // Put it back unless the student has changed the answer meanwhile, then try again.
        if (!this.pending.has(questionId)) this.pending.set(questionId, selected);
        this.opts.onState(questionId, "retrying");
        await wait(retryDelay(tries++));
      }
    }
  }
}

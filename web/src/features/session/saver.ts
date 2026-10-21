import { ApiError } from "../../lib/api";
import { retryDelay } from "../../lib/session";

export type SaveState = "saving" | "saved" | "retrying" | "failed";

/** Why saving stopped for good: the attempt ended, or it is open on another device. */
export type SaveStop = "ended" | "elsewhere";

interface Options {
  save: (questionId: string, selected: string[]) => Promise<unknown>;
  onState: (questionId: string, state: SaveState, message?: string) => void;
  onStop: (reason: SaveStop) => void;
  /** Injected in tests. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Network errors and 5xx are worth retrying; a 4xx answer won't change. */
const transient = (e: unknown) => !(e instanceof ApiError) || e.status >= 500;

/**
 * Autosave for the exam page. Per question, the latest selection wins: a change made while a save
 * is in flight is sent right after it, and older ones are dropped. Failed saves retry with backoff
 * until they succeed, so a short network drop loses nothing. `flush()` waits for everything.
 */
export class AnswerSaver {
  private pending = new Map<string, string[]>();
  private running = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(private readonly opts: Options) {}

  set(questionId: string, selected: string[]): void {
    if (this.stopped) return;
    this.pending.set(questionId, selected);
    this.opts.onState(questionId, "saving");
    if (!this.running.has(questionId)) {
      const run = this.drain(questionId).finally(() => this.running.delete(questionId));
      this.running.set(questionId, run);
    }
  }

  /** Resolves once nothing is waiting or in flight (failed saves give up after `maxTries`). */
  async flush(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running.values()]);
  }

  stop(): void {
    this.stopped = true;
    this.pending.clear();
  }

  private async drain(questionId: string, maxTries = 6): Promise<void> {
    const wait = this.opts.wait ?? sleep;
    let tries = 0;
    while (!this.stopped) {
      const selected = this.pending.get(questionId);
      if (!selected) return;
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

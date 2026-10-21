import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { AnswerSaver, type SaveState } from "./saver";

function setup(save: (q: string, s: string[]) => Promise<unknown>) {
  const states: [string, SaveState][] = [];
  const onStop = vi.fn();
  const saver = new AnswerSaver({
    save,
    onState: (q, s) => states.push([q, s]),
    onStop,
    wait: () => Promise.resolve(),
  });
  return { saver, states, onStop };
}

describe("autosave", () => {
  it("sends the latest selection; changes made in flight follow, stale ones are dropped", async () => {
    const sent: string[][] = [];
    let release: () => void = () => undefined;
    const save = vi.fn((_q: string, s: string[]) => {
      sent.push(s);
      return sent.length === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    });
    const { saver, states } = setup(save);
    saver.set("q1", ["a"]);
    saver.set("q1", ["b"]);
    saver.set("q1", ["c"]);
    release();
    await saver.flush();
    expect(sent).toEqual([["a"], ["c"]]);
    expect(states.at(-1)).toEqual(["q1", "saved"]);
  });

  it("retries network errors until the save gets through", async () => {
    let calls = 0;
    const { saver, states } = setup(() => (++calls < 3 ? Promise.reject(new TypeError("offline")) : Promise.resolve()));
    saver.set("q1", ["a"]);
    await saver.flush();
    expect(calls).toBe(3);
    expect(states.map((s) => s[1])).toEqual(["saving", "retrying", "retrying", "saved"]);
  });

  it("gives up on a refused answer, and stops when the attempt ends or moved elsewhere", async () => {
    const refused = setup(() => Promise.reject(new ApiError(400, "VALIDATION_FAILED", "Not a valid choice.")));
    refused.saver.set("q1", ["a"]);
    await refused.saver.flush();
    expect(refused.states.at(-1)).toEqual(["q1", "failed"]);
    expect(refused.onStop).not.toHaveBeenCalled();

    const closed = setup(() => Promise.reject(new ApiError(409, "ATTEMPT_CLOSED")));
    closed.saver.set("q1", ["a"]);
    await closed.saver.flush();
    expect(closed.onStop).toHaveBeenCalledWith("ended");
    closed.saver.set("q2", ["b"]); // ignored after stop
    await closed.saver.flush();
    expect(closed.states.filter((s) => s[0] === "q2")).toEqual([]);

    const elsewhere = setup(() => Promise.reject(new ApiError(409, "ATTEMPT_IN_PROGRESS_ELSEWHERE")));
    elsewhere.saver.set("q1", ["a"]);
    await elsewhere.saver.flush();
    expect(elsewhere.onStop).toHaveBeenCalledWith("elsewhere");
  });

  it("saves different questions independently", async () => {
    const save = vi.fn(() => Promise.resolve());
    const { saver } = setup(save);
    saver.set("q1", ["a"]);
    saver.set("q2", ["b", "c"]);
    await saver.flush();
    expect(save).toHaveBeenCalledWith("q1", ["a"]);
    expect(save).toHaveBeenCalledWith("q2", ["b", "c"]);
  });
});

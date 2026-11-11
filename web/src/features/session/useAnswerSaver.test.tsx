import { act, render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAnswerSaver, type Saver } from "./useAnswerSaver";

type Options = Parameters<typeof useAnswerSaver<string[]>>[1];

const options = (): Options & { save: ReturnType<typeof vi.fn> } => ({
  save: vi.fn().mockResolvedValue({}),
  onState: vi.fn(),
  onStop: vi.fn(),
});

/**
 * A page using the saver, in Strict Mode as in development: React mounts it, runs the effects'
 * cleanup, then runs the effects again. `ready` gets the saver once the page is mounted.
 */
function mount(o: Options, ready: (saver: Saver<string[]>) => void) {
  function Page() {
    const saver = useAnswerSaver("attempt-1", o);
    useEffect(() => {
      ready(saver);
    }, [saver]);
    return null;
  }
  return render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

describe("the exam page's autosave", () => {
  it("still saves after React mounts the page twice (regression: answers were silently dropped)", async () => {
    const o = options();
    let saver: Saver<string[]> | undefined;
    mount(o, (s) => (saver = s));
    saver?.set("q1", ["a"]);
    await settle();
    expect(o.save).toHaveBeenCalledWith("q1", ["a"]);
    expect(o.onState).toHaveBeenCalledWith("q1", "saved", undefined);
  });

  it("sends typing that was waiting when the student submits", async () => {
    const o = options();
    let saver: Saver<string[]> | undefined;
    mount(o, (s) => (saver = s));
    saver?.setLater("essay", ["draft"], 10_000);
    await act(() => saver?.flush() ?? Promise.resolve());
    expect(o.save).toHaveBeenCalledWith("essay", ["draft"]);
  });

  it("stops for good when the page closes", async () => {
    const o = options();
    let saver: Saver<string[]> | undefined;
    const view = mount(o, (s) => (saver = s));
    view.unmount();
    saver?.set("q1", ["a"]);
    await settle();
    expect(o.save).not.toHaveBeenCalled();
  });
});

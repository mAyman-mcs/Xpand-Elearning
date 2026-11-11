import type { StudentQuestion } from "@contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuestionMap, screenState } from "./QuestionMap";

const q = (index: number): StudentQuestion => ({ id: `q${index}`, index }) as StudentQuestion;
const blocks = [[q(0)], [q(1)], [q(2)], [q(3)]];

describe("a screen's state on the map", () => {
  const base = { here: false, answered: false, allowBack: true, first: 1, currentFirst: 2 };
  it("with going back: current, answered or not", () => {
    expect(screenState({ ...base, here: true })).toBe("current");
    expect(screenState({ ...base, answered: true })).toBe("answered");
    expect(screenState(base)).toBe("unanswered");
  });

  it("without going back: passed screens are locked, later ones not reached yet", () => {
    expect(screenState({ ...base, allowBack: false, answered: true })).toBe("locked");
    expect(screenState({ ...base, allowBack: false, first: 3 })).toBe("ahead");
  });
});

describe("the question map", () => {
  const answered = new Set(["q0"]);
  const renderMap = (allowBack: boolean, current = blocks[1]!) => {
    const onOpen = vi.fn();
    render(
      <QuestionMap
        blocks={blocks}
        current={current}
        allowBack={allowBack}
        isAnswered={(x) => answered.has(x.id)}
        onOpen={onOpen}
      />,
    );
    return onOpen;
  };

  it("names every state for screen readers and opens answered or blank screens", async () => {
    const onOpen = renderMap(true);
    expect(screen.getByRole("button", { name: "Question 2, current" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Question 3, not answered" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Question 1, answered" }));
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  it("shows the whole exam without going back, but opens nothing", async () => {
    const onOpen = renderMap(false, blocks[2]!);
    expect(screen.getAllByRole("button", { name: /^Question \d/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Question 1, locked" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Question 4, not reached yet" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Question 2, locked" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

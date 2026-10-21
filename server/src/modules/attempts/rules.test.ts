import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ViolationType } from "../../generated/prisma/enums.js";
import {
  acceptsAnswers,
  applyEvent,
  CLIENT_EVENT_TYPES,
  deadlineFor,
  deliveryOrder,
  grade,
  GRACE_MS,
  isOverdue,
  MERGE_MS,
  shuffled,
  validSelection,
  type StrikeState,
} from "./rules.js";

const T0 = new Date("2026-11-01T08:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("deadlineFor (E7)", () => {
  it("is the duration plus extra time", () => {
    expect(deadlineFor(T0, 45, 0, null)).toEqual(at(45 * 60_000));
    expect(deadlineFor(T0, 45, 10, null)).toEqual(at(55 * 60_000));
  });
  it("never runs past the window's close", () => {
    expect(deadlineFor(T0, 45, 0, at(5 * 60_000))).toEqual(at(5 * 60_000));
    expect(deadlineFor(T0, 45, 0, at(60 * 60_000))).toEqual(at(45 * 60_000));
  });
});

describe("grace period (E8)", () => {
  const deadline = at(0);
  it("accepts answers up to 5 s after the deadline, then the attempt is overdue", () => {
    expect(acceptsAnswers(deadline, at(GRACE_MS))).toBe(true);
    expect(acceptsAnswers(deadline, at(GRACE_MS + 1))).toBe(false);
    expect(isOverdue(deadline, at(GRACE_MS + 1))).toBe(true);
    expect(isOverdue(deadline, at(-1))).toBe(false);
  });
});

describe("delivery order", () => {
  const questions = [
    { id: "q1", options: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    { id: "q2", options: [{ id: "d" }, { id: "e" }] },
    { id: "q3", options: [{ id: "f" }, { id: "g" }] },
  ];
  it("keeps the authored order when shuffling is off", () => {
    expect(deliveryOrder(questions, { shuffleQuestions: false, shuffleOptions: false }, Math.random)).toEqual({
      questionOrder: ["q1", "q2", "q3"],
      optionOrder: { q1: ["a", "b", "c"], q2: ["d", "e"], q3: ["f", "g"] },
    });
  });
  it("shuffling is a permutation (nothing lost or duplicated)", () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { maxLength: 30 }), fc.double({ min: 0, max: 0.999, noNaN: true }), (items, seed) => {
        let x = seed;
        const random = () => (x = (x * 9301 + 0.49297) % 1);
        expect([...shuffled(items, random)].sort()).toEqual([...items].sort());
      }),
    );
    // A broken random source still loses nothing.
    for (const bad of [1, -0.5, Number.NaN]) expect(shuffled([1, 2, 3], () => bad).sort()).toEqual([1, 2, 3]);
  });
});

describe("validSelection", () => {
  it("accepts own options, at most one unless multiple choice, and clearing", () => {
    expect(validSelection("SINGLE_CHOICE", ["a", "b"], ["a"])).toBe(true);
    expect(validSelection("SINGLE_CHOICE", ["a", "b"], [])).toBe(true);
    expect(validSelection("SINGLE_CHOICE", ["a", "b"], ["a", "b"])).toBe(false);
    expect(validSelection("MULTI_CHOICE", ["a", "b"], ["a", "b"])).toBe(true);
    expect(validSelection("TRUE_FALSE", ["a", "b"], ["x"])).toBe(false);
    expect(validSelection("MULTI_CHOICE", ["a", "b"], ["a", "a"])).toBe(false);
  });
});

describe("grade (E2: all or nothing)", () => {
  const questions = [
    { id: "q1", points: 1, correctOptionIds: ["a"] },
    { id: "q2", points: 2, correctOptionIds: ["c", "d"] },
    { id: "q3", points: 1.5, correctOptionIds: ["f"] },
  ];
  it("scores exact matches only; unanswered is 0", () => {
    const result = grade(
      questions,
      new Map([
        ["q1", ["a"]],
        ["q2", ["c"]], // partly right: 0
      ]),
    );
    expect(result).toEqual({
      score: 1,
      maxScore: 4.5,
      perQuestion: [
        { questionId: "q1", correct: true, points: 1 },
        { questionId: "q2", correct: false, points: 0 },
        { questionId: "q3", correct: false, points: 0 },
      ],
    });
    expect(grade(questions, new Map([["q2", ["d", "c"]]])).score).toBe(2);
    expect(grade(questions, new Map([["q2", ["c", "d", "e"]]])).score).toBe(0);
  });
  it("never exceeds the maximum", () => {
    fc.assert(
      fc.property(fc.array(fc.subarray(["a", "c", "d", "f", "x"])), (picks) => {
        const answers = new Map(picks.map((p, i) => [`q${(i % 3) + 1}`, p]));
        const r = grade(questions, answers);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(r.maxScore);
      }),
    );
  });
});

describe("applyEvent (E9)", () => {
  const fresh: StrikeState = { strikes: 0, strikeMergedUntil: null, strikeLimit: 3 };

  it("one action fires several signals: they count as one strike", () => {
    const first = applyEvent(fresh, "TAB_HIDDEN", at(0));
    expect(first).toMatchObject({ countsAsStrike: true, strikes: 1, action: "WARN" });
    const state = { ...fresh, strikes: first.strikes, strikeMergedUntil: first.strikeMergedUntil };
    expect(applyEvent(state, "WINDOW_BLUR", at(MERGE_MS - 100))).toMatchObject({
      countsAsStrike: false,
      strikes: 1,
      action: "LOGGED",
    });
    expect(applyEvent(state, "FULLSCREEN_EXIT", at(MERGE_MS + 100))).toMatchObject({
      countsAsStrike: true,
      strikes: 2,
    });
  });

  it("blocked actions and DevTools are logged, never strikes", () => {
    for (const type of [
      "CLIPBOARD",
      "CONTEXT_MENU",
      "BLOCKED_SHORTCUT",
      "DEVTOOLS",
      "HEARTBEAT_MISSED",
    ] as ViolationType[])
      expect(applyEvent(fresh, type, at(0))).toMatchObject({ countsAsStrike: false, strikes: 0, action: "LOGGED" });
  });

  it("the strike that reaches the limit auto-submits", () => {
    expect(applyEvent({ ...fresh, strikes: 2 }, "RESIZE", at(0)).action).toBe("AUTO_SUBMITTED");
    expect(applyEvent({ ...fresh, strikes: 0, strikeLimit: 1 }, "DEVICE_CHANGE", at(0)).action).toBe("AUTO_SUBMITTED");
  });

  it("strikes never decrease and auto-submit happens exactly at the limit (any event sequence)", () => {
    const eventArb = fc.record({
      type: fc.constantFrom(...CLIENT_EVENT_TYPES),
      gap: fc.integer({ min: 0, max: 10_000 }),
    });
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), fc.integer({ min: 1, max: 5 }), (events, limit) => {
        let state: StrikeState = { strikes: 0, strikeMergedUntil: null, strikeLimit: limit };
        let t = 0;
        for (const e of events) {
          t += e.gap;
          const r = applyEvent(state, e.type, at(t));
          expect(r.strikes).toBeGreaterThanOrEqual(state.strikes);
          expect(r.action === "AUTO_SUBMITTED").toBe(r.countsAsStrike && r.strikes >= limit);
          state = { ...state, strikes: r.strikes, strikeMergedUntil: r.strikeMergedUntil };
          if (r.action === "AUTO_SUBMITTED") break;
        }
      }),
    );
  });
});

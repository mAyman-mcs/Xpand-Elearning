import { describe, expect, it } from "vitest";
import { cairoWallTime } from "./time.js";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const utc = (d: Date) => d.toISOString();

describe("cairoWallTime", () => {
  it("uses UTC+2 in winter and UTC+3 in summer", () => {
    expect(utc(cairoWallTime(day("2026-01-15"), 0, "10:00"))).toBe("2026-01-15T08:00:00.000Z");
    expect(utc(cairoWallTime(day("2026-07-05"), 0, "10:00"))).toBe("2026-07-05T07:00:00.000Z");
  });

  it("adds calendar days, across month ends", () => {
    expect(utc(cairoWallTime(day("2026-07-05"), 14, "10:00"))).toBe("2026-07-19T07:00:00.000Z");
    expect(utc(cairoWallTime(day("2026-07-25"), 10, "09:30"))).toBe("2026-08-04T06:30:00.000Z");
  });

  it("keeps the wall-clock time across the spring-forward change (24 Apr 2026)", () => {
    expect(utc(cairoWallTime(day("2026-04-20"), 3, "10:00"))).toBe("2026-04-23T08:00:00.000Z"); // EET
    expect(utc(cairoWallTime(day("2026-04-20"), 5, "10:00"))).toBe("2026-04-25T07:00:00.000Z"); // EEST
  });

  it("keeps the wall-clock time across the fall-back change (29/30 Oct 2026)", () => {
    expect(utc(cairoWallTime(day("2026-10-26"), 3, "10:00"))).toBe("2026-10-29T07:00:00.000Z"); // EEST
    expect(utc(cairoWallTime(day("2026-10-26"), 4, "10:00"))).toBe("2026-10-30T08:00:00.000Z"); // EET
  });

  it("resolves a non-existent time forward and an ambiguous time to its first occurrence", () => {
    expect(utc(cairoWallTime(day("2026-04-24"), 0, "00:30"))).toBe("2026-04-23T22:30:00.000Z");
    expect(utc(cairoWallTime(day("2026-10-29"), 0, "23:30"))).toBe("2026-10-29T20:30:00.000Z");
  });

  it("rejects malformed times", () => {
    expect(() => cairoWallTime(day("2026-07-05"), 0, "24:00")).toThrow();
    expect(() => cairoWallTime(day("2026-07-05"), 0, "9:00")).toThrow();
  });
});

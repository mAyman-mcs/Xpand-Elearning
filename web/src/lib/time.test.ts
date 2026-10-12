import { describe, expect, it } from "vitest";
import { cairoToIso, formatDate, formatInstant, formatMinutes, isoToCairo, todayInCairo } from "./time";

describe("Cairo time helpers", () => {
  it("converts Cairo wall time to UTC in summer (UTC+3) and winter (UTC+2)", () => {
    expect(cairoToIso("2026-07-19", "10:00")).toBe("2026-07-19T07:00:00.000Z");
    expect(cairoToIso("2026-12-01", "10:00")).toBe("2026-12-01T08:00:00.000Z");
  });

  it("handles the days of the daylight-saving changes (24 Apr and 29/30 Oct 2026)", () => {
    expect(cairoToIso("2026-04-23", "10:00")).toBe("2026-04-23T08:00:00.000Z");
    expect(cairoToIso("2026-04-24", "10:00")).toBe("2026-04-24T07:00:00.000Z");
    expect(cairoToIso("2026-10-29", "10:00")).toBe("2026-10-29T07:00:00.000Z");
    expect(cairoToIso("2026-10-30", "10:00")).toBe("2026-10-30T08:00:00.000Z");
  });

  it("round-trips through the form representation", () => {
    for (const iso of ["2026-07-19T07:00:00.000Z", "2026-12-01T08:30:00.000Z", "2026-10-30T08:00:00.000Z"]) {
      const { date, time } = isoToCairo(iso);
      expect(cairoToIso(date, time)).toBe(iso);
    }
  });

  it("formats instants in Cairo time with the zone label, never the browser's zone", () => {
    expect(formatInstant("2026-07-19T07:00:00.000Z")).toBe("19 Jul 2026, 10:00 Cairo");
    expect(formatInstant(null)).toBe("—");
  });

  it("formats calendar dates without shifting the day", () => {
    expect(formatDate("2026-07-01")).toBe("1 Jul 2026");
    expect(formatDate(null)).toBe("—");
  });

  it("gives today's Cairo date (late evening UTC is already tomorrow in Cairo)", () => {
    expect(todayInCairo(new Date("2026-07-19T22:30:00Z"))).toBe("2026-07-20");
  });

  it("formats durations", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(1440 + 90)).toBe("1 day 1 h 30 min");
  });
});

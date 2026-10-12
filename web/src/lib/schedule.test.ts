import { describe, expect, it } from "vitest";
import { describeSchedule, draftFromSchedule, EMPTY_SCHEDULE, toScheduleInput } from "./schedule";

describe("toScheduleInput", () => {
  it("FIXED: Cairo wall times become UTC instants; the closing time is optional", () => {
    expect(
      toScheduleInput({
        ...EMPTY_SCHEDULE,
        mode: "FIXED",
        opensDate: "2026-07-19",
        opensTime: "10:00",
        closesDate: "2026-07-19",
        closesTime: "12:00",
      }),
    ).toEqual({
      schedule: { mode: "FIXED", opensAt: "2026-07-19T07:00:00.000Z", closesAt: "2026-07-19T09:00:00.000Z" },
    });
    expect(toScheduleInput({ ...EMPTY_SCHEDULE, mode: "FIXED", opensDate: "2026-12-01", closesDate: "" })).toEqual({
      schedule: { mode: "FIXED", opensAt: "2026-12-01T08:00:00.000Z", closesAt: null },
    });
  });

  it("FIXED: needs an opening, and a close after the opening", () => {
    expect(toScheduleInput({ ...EMPTY_SCHEDULE, mode: "FIXED" })).toEqual({
      problems: ["Choose when it opens (date and time)."],
    });
    expect(
      toScheduleInput({
        ...EMPTY_SCHEDULE,
        mode: "FIXED",
        opensDate: "2026-07-19",
        opensTime: "12:00",
        closesDate: "2026-07-19",
        closesTime: "10:00",
      }),
    ).toEqual({ problems: ["It must close after it opens."] });
  });

  it("RELATIVE: day offset, Cairo time and a window in hours and minutes", () => {
    expect(
      toScheduleInput({
        ...EMPTY_SCHEDULE,
        mode: "RELATIVE",
        offsetDays: "14",
        openTime: "10:00",
        windowHours: "1",
        windowMins: "30",
      }),
    ).toEqual({
      schedule: { mode: "RELATIVE", offsetDays: 14, openTime: "10:00", windowMinutes: 90 },
    });
    expect(
      toScheduleInput({ ...EMPTY_SCHEDULE, mode: "RELATIVE", offsetDays: "-1", windowHours: "0", windowMins: "0" }),
    ).toEqual({
      problems: ["Days after joining: a whole number from 0 to 366.", "Open for: between 1 minute and 14 days."],
    });
  });

  it("MANUAL needs nothing", () => {
    expect(toScheduleInput({ ...EMPTY_SCHEDULE, mode: "MANUAL" })).toEqual({ schedule: { mode: "MANUAL" } });
  });
});

describe("draftFromSchedule ↔ toScheduleInput", () => {
  it("round-trips a saved schedule", () => {
    const fixed = {
      mode: "FIXED" as const,
      opensAt: "2026-10-30T08:00:00.000Z",
      closesAt: "2026-10-30T10:30:00.000Z",
      offsetDays: null,
      openTime: null,
      windowMinutes: null,
    };
    expect(toScheduleInput(draftFromSchedule(fixed))).toEqual({
      schedule: { mode: "FIXED", opensAt: fixed.opensAt, closesAt: fixed.closesAt },
    });
    const relative = {
      mode: "RELATIVE" as const,
      opensAt: null,
      closesAt: null,
      offsetDays: 7,
      openTime: "09:30",
      windowMinutes: 150,
    };
    expect(toScheduleInput(draftFromSchedule(relative))).toEqual({
      schedule: { mode: "RELATIVE", offsetDays: 7, openTime: "09:30", windowMinutes: 150 },
    });
  });
});

describe("describeSchedule", () => {
  it("reads naturally", () => {
    expect(describeSchedule({ mode: "RELATIVE", offsetDays: 14, openTime: "10:00", windowMinutes: 120 })).toBe(
      "Day 14 after joining, 10:00 Cairo, open for 2 h",
    );
    expect(describeSchedule({ mode: "RELATIVE", offsetDays: 0, openTime: "09:00", windowMinutes: 45 })).toBe(
      "On the join day, 09:00 Cairo, open for 45 min",
    );
    expect(describeSchedule({ mode: "FIXED", opensAt: "2026-07-19T07:00:00.000Z", closesAt: null })).toBe(
      "19 Jul 2026, 10:00 Cairo → no end",
    );
    expect(describeSchedule({ mode: "MANUAL" })).toBe("Manual: closed until staff open it");
  });
});

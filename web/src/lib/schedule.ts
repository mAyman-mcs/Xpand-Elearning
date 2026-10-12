import type { Schedule, ScheduleMode } from "@contracts";
import type { ScheduleInput } from "./api";
import { cairoToIso, formatInstant, formatMinutes, isoToCairo } from "./time";

/** What the schedule form holds: Cairo wall times as entered, before conversion. */
export interface ScheduleDraft {
  mode: ScheduleMode;
  opensDate: string;
  opensTime: string;
  closesDate: string;
  closesTime: string;
  offsetDays: string;
  openTime: string;
  windowHours: string;
  windowMins: string;
}

export const EMPTY_SCHEDULE: ScheduleDraft = {
  mode: "FIXED",
  opensDate: "",
  opensTime: "10:00",
  closesDate: "",
  closesTime: "12:00",
  offsetDays: "14",
  openTime: "10:00",
  windowHours: "2",
  windowMins: "0",
};

export function draftFromSchedule(s: Schedule): ScheduleDraft {
  const opens = s.opensAt ? isoToCairo(s.opensAt) : null;
  const closes = s.closesAt ? isoToCairo(s.closesAt) : null;
  const window = s.windowMinutes ?? 120;
  return {
    mode: s.mode,
    opensDate: opens?.date ?? "",
    opensTime: opens?.time ?? "10:00",
    closesDate: closes?.date ?? "",
    closesTime: closes?.time ?? "12:00",
    offsetDays: String(s.offsetDays ?? 14),
    openTime: s.openTime ?? "10:00",
    windowHours: String(Math.floor(window / 60)),
    windowMins: String(window % 60),
  };
}

const wholeNumber = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** The API schedule, or the problems to fix first (the server checks again). */
export function toScheduleInput(d: ScheduleDraft): { schedule: ScheduleInput } | { problems: string[] } {
  if (d.mode === "MANUAL") return { schedule: { mode: "MANUAL" } };

  if (d.mode === "FIXED") {
    const problems: string[] = [];
    if (!d.opensDate || !isTime(d.opensTime)) problems.push("Choose when it opens (date and time).");
    const hasClose = !!d.closesDate;
    if (hasClose && !isTime(d.closesTime)) problems.push("Choose the closing time.");
    if (problems.length) return { problems };
    const opensAt = cairoToIso(d.opensDate, d.opensTime);
    const closesAt = hasClose ? cairoToIso(d.closesDate, d.closesTime) : null;
    if (closesAt && closesAt <= opensAt) return { problems: ["It must close after it opens."] };
    return { schedule: { mode: "FIXED", opensAt, closesAt } };
  }

  const offsetDays = wholeNumber(d.offsetDays);
  const windowMinutes = wholeNumber(d.windowHours) * 60 + wholeNumber(d.windowMins);
  const problems: string[] = [];
  if (!(offsetDays >= 0 && offsetDays <= 366)) problems.push("Days after joining: a whole number from 0 to 366.");
  if (!isTime(d.openTime)) problems.push("Choose the opening time.");
  if (!(windowMinutes >= 1 && windowMinutes <= 20160)) problems.push("Open for: between 1 minute and 14 days.");
  if (problems.length) return { problems };
  return { schedule: { mode: "RELATIVE", offsetDays, openTime: d.openTime, windowMinutes } };
}

/** A schedule in words, e.g. "Day 14 after joining, 10:00 Cairo, open for 2 h". */
export function describeSchedule(s: Schedule | ScheduleInput): string {
  switch (s.mode) {
    case "MANUAL":
      return "Manual: closed until staff open it";
    case "FIXED": {
      const opensAt = "opensAt" in s ? s.opensAt : null;
      const closesAt = "closesAt" in s ? s.closesAt : null;
      return `${formatInstant(opensAt)} → ${closesAt ? formatInstant(closesAt) : "no end"}`;
    }
    case "RELATIVE": {
      const days = "offsetDays" in s ? (s.offsetDays ?? 0) : 0;
      const time = "openTime" in s ? s.openTime : null;
      const minutes = "windowMinutes" in s ? (s.windowMinutes ?? 0) : 0;
      const day = days === 0 ? "On the join day" : `Day ${days} after joining`;
      return `${day}, ${time ?? "?"} Cairo, open for ${formatMinutes(minutes)}`;
    }
  }
}

import { TZDate } from "@date-fns/tz";

/**
 * The only place that converts between Cairo wall-clock time and UTC instants (decision D9).
 * Everything is stored in UTC; schedules are expressed in Cairo time because that is what staff
 * and students read on the wall. Egypt observes daylight saving time, so never add fixed offsets.
 *
 * Transition behaviour (pinned by tests):
 * - Spring forward (last Friday of April, 00:00 → 01:00): a wall time inside the missing hour
 *   (e.g. 00:30) resolves to the same instant as one hour later (01:30 summer time).
 * - Fall back (last Thursday of October, 24:00 → 23:00): an ambiguous wall time (e.g. 23:30)
 *   resolves to its first occurrence (still summer time).
 */
export const APP_TIME_ZONE = "Africa/Cairo";

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The UTC instant of `time` ("HH:mm", Cairo) on the calendar day `offsetDays` after `date`.
 * `date` is a calendar date as stored in @db.Date columns (UTC midnight).
 */
export function cairoWallTime(date: Date, offsetDays: number, time: string): Date {
  const match = HH_MM.exec(time);
  if (!match) throw new Error(`invalid time "${time}", expected HH:mm`);
  const [, hh, mm] = match;
  const local = new TZDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + offsetDays,
    Number(hh),
    Number(mm),
    APP_TIME_ZONE,
  );
  return new Date(local.getTime());
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

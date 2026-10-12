import { TZDate } from "@date-fns/tz";

// All times are shown and entered in Africa/Cairo and sent to the API as UTC (A-D6). The browser's
// own time zone is never used, so an admin abroad or a daylight-saving change can't shift a schedule.
export const ZONE = "Africa/Cairo";
export const ZONE_LABEL = "Cairo";

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** "12 Oct 2026, 14:30 Cairo" for an ISO instant; "—" for null. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${dateTimeFmt.format(new Date(iso))} ${ZONE_LABEL}`;
}

/** "12 Oct 2026" for a calendar date "YYYY-MM-DD" (no time zone involved). */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  return dateFmt.format(new Date(`${ymd}T00:00:00Z`));
}

/** A Cairo wall time ("2026-10-30", "10:00") as a UTC ISO instant. */
export function cairoToIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // TZDate.toISOString() keeps the Cairo offset; the API contract is UTC ("…Z").
  return new Date(new TZDate(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, ZONE).getTime()).toISOString();
}

/** An ISO instant as Cairo wall time, for form fields. */
export function isoToCairo(iso: string): { date: string; time: string } {
  const t = new TZDate(iso, ZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
    time: `${pad(t.getHours())}:${pad(t.getMinutes())}`,
  };
}

/** Today's date in Cairo, "YYYY-MM-DD". */
export function todayInCairo(now = new Date()): string {
  return isoToCairo(now.toISOString()).date;
}

/** "2 h", "45 min", "1 day 2 h" for a number of minutes. */
export function formatMinutes(total: number): string {
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const parts = [
    days ? `${days} day${days > 1 ? "s" : ""}` : "",
    hours ? `${hours} h` : "",
    minutes ? `${minutes} min` : "",
  ].filter(Boolean);
  return parts.join(" ") || "0 min";
}

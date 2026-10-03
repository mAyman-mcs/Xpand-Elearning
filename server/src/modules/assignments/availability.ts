import { addMinutes, cairoWallTime } from "../../core/time.js";
import type {
  AttemptStatus,
  ExamStatus,
  OverrideAction,
  ReviewStatus,
  ScheduleMode,
} from "../../generated/prisma/enums.js";

// Pure rules for "can this student take this exam now, and why?" (docs/BACKEND_PLAN.md §5.1).
// No database access: callers load the inputs; tests feed plain data.

export type AvailabilityStatus =
  | "NOT_ASSIGNED" // no assignment reaches the student
  | "SCHEDULED" // a window opens later
  | "OPEN" // can start (or resume) now
  | "CLOSED" // not open: closed by staff, manual-only, archived/draft, or window over after an attempt
  | "MISSED" // every window is over and the student never attempted
  | "SUBMITTED" // all attempts used
  | "EXTERNAL"; // taken outside the platform (e.g. CTF)

/** The student-facing progress through one exam. */
export type Progress = "NOT_STARTED" | "IN_PROGRESS" | "ANSWERED" | "UNDER_REVIEW" | "REVIEWED";

export interface ScheduleFields {
  mode: ScheduleMode;
  opensAt: Date | null;
  closesAt: Date | null;
  offsetDays: number | null;
  openTime: string | null;
  windowMinutes: number | null;
}

export interface AssignmentInput extends ScheduleFields {
  id: string;
  userId: string | null;
  groupId: string | null;
}

export interface OverrideInput {
  id: string;
  userId: string | null;
  groupId: string | null;
  action: OverrideAction;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
}

export interface StudentInput {
  id: string;
  /** Anchor for relative schedules on assignments that target the student directly. */
  joinDate: Date | null;
  memberships: { groupId: string; joinDate: Date | null; intakeStartDate: Date }[];
}

export interface AttemptInput {
  status: AttemptStatus;
  reviewStatus: ReviewStatus;
  attemptNo: number;
}

export interface ExamInput {
  status: ExamStatus;
  isExternal: boolean;
  maxAttempts: number;
}

export interface Window {
  opensAt: Date;
  /** null: open-ended. */
  closesAt: Date | null;
}

export interface Availability {
  status: AvailabilityStatus;
  progress: Progress;
  opensAt: Date | null;
  closesAt: Date | null;
  /** What decided the status, e.g. "user-override", "group-assignment", "attempts". */
  source: string;
  reason: string;
}

/**
 * The window an assignment gives, or null when it has none (MANUAL, or RELATIVE without an
 * anchor date). Shared with the schedule preview so preview and reality can never differ.
 */
export function scheduleWindow(schedule: ScheduleFields, anchor: Date | null): Window | null {
  switch (schedule.mode) {
    case "FIXED":
      return schedule.opensAt ? { opensAt: schedule.opensAt, closesAt: schedule.closesAt } : null;
    case "RELATIVE": {
      if (!anchor || schedule.offsetDays === null || !schedule.openTime || !schedule.windowMinutes) return null;
      const opensAt = cairoWallTime(anchor, schedule.offsetDays, schedule.openTime);
      return { opensAt, closesAt: addMinutes(opensAt, schedule.windowMinutes) };
    }
    case "MANUAL":
      return null;
  }
}

/** The date a relative schedule counts from: the member's join date, else the group's intake date. */
export function anchorFor(assignment: Pick<AssignmentInput, "userId" | "groupId">, student: StudentInput): Date | null {
  if (assignment.userId) return student.joinDate;
  const membership = student.memberships.find((m) => m.groupId === assignment.groupId);
  return membership ? (membership.joinDate ?? membership.intakeStartDate) : null;
}

export function progressOf(attempts: AttemptInput[]): Progress {
  const latest = attempts.filter((a) => a.status !== "VOIDED").sort((a, b) => b.attemptNo - a.attemptNo)[0];
  if (!latest) return "NOT_STARTED";
  if (latest.status === "IN_PROGRESS") return "IN_PROGRESS";
  switch (latest.reviewStatus) {
    case "PENDING":
      return "ANSWERED";
    case "UNDER_REVIEW":
      return "UNDER_REVIEW";
    case "REVIEWED":
      return "REVIEWED";
  }
}

const isActiveOverride = (o: OverrideInput, now: Date) => o.validFrom <= now && (!o.validUntil || now < o.validUntil);
const inWindow = (w: Window, now: Date) => w.opensAt <= now && (!w.closesAt || now < w.closesAt);

export function resolveAvailability(input: {
  exam: ExamInput;
  student: StudentInput;
  assignments: AssignmentInput[];
  overrides: OverrideInput[];
  attempts: AttemptInput[];
  now: Date;
}): Availability {
  const { exam, student, now } = input;
  const groupIds = new Set(student.memberships.map((m) => m.groupId));
  const reaches = (t: { userId: string | null; groupId: string | null }) =>
    t.userId === student.id || (t.groupId !== null && groupIds.has(t.groupId));

  const progress = progressOf(input.attempts);
  const result = (status: AvailabilityStatus, source: string, reason: string, window?: Partial<Window>) => ({
    status,
    progress,
    opensAt: window?.opensAt ?? null,
    closesAt: window?.closesAt ?? null,
    source,
    reason,
  });

  // 1. Visibility comes from assignments only (an override alone does not assign an exam).
  const assignments = input.assignments.filter(reaches);
  if (assignments.length === 0) return result("NOT_ASSIGNED", "none", "This exam is not assigned to the student.");

  // 2. The exam itself.
  if (exam.status === "DRAFT") return result("CLOSED", "exam", "The exam is not published yet.");
  if (exam.status === "ARCHIVED") return result("CLOSED", "exam", "The exam is archived.");
  if (exam.isExternal) return result("EXTERNAL", "exam", "Taken outside the platform; scores are entered by staff.");

  // 3. Attempts: an attempt in progress can always be resumed (its own deadline applies);
  //    used-up attempts end it — overrides never reopen a submitted exam.
  if (progress === "IN_PROGRESS") return result("OPEN", "attempts", "An attempt is in progress.");
  const used = input.attempts.filter((a) => a.status !== "VOIDED" && a.status !== "IN_PROGRESS").length;
  if (used >= exam.maxAttempts) return result("SUBMITTED", "attempts", "All attempts have been used.");

  // 4. Overrides: a user override beats group overrides; among group overrides, CLOSE wins.
  const active = input.overrides.filter((o) => reaches(o) && isActiveOverride(o, now));
  const userOverride = active
    .filter((o) => o.userId === student.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const groupOverrides = active.filter((o) => o.userId !== student.id);
  const override =
    userOverride ?? groupOverrides.find((o) => o.action === "CLOSE") ?? groupOverrides.find((o) => o.action === "OPEN");
  if (override) {
    const source = override.userId ? "user-override" : "group-override";
    return override.action === "OPEN"
      ? result("OPEN", source, "Opened by staff.", { opensAt: override.validFrom, closesAt: override.validUntil })
      : result("CLOSED", source, "Closed by staff.");
  }

  // 5. Schedules: a personal assignment replaces the group ones (D7); group windows add up.
  const personal = assignments.filter((a) => a.userId === student.id);
  const chosen = personal.length > 0 ? personal : assignments;
  const source = personal.length > 0 ? "user-assignment" : "group-assignment";
  const windows = chosen.map((a) => scheduleWindow(a, anchorFor(a, student))).filter((w): w is Window => w !== null);

  const open = windows.filter((w) => inWindow(w, now));
  if (open.length > 0) {
    // Several open windows: the one that stays open longest decides when it closes.
    const ends = open.map((w) => w.closesAt);
    const closesAt = ends.every((d): d is Date => d !== null) ? latest(ends) : null;
    const opensAt = new Date(Math.min(...open.map((w) => w.opensAt.getTime())));
    return result("OPEN", source, "Within the scheduled window.", { opensAt, closesAt });
  }

  const upcoming = windows.filter((w) => w.opensAt > now).sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime())[0];
  if (upcoming) return result("SCHEDULED", source, "Opens at the scheduled time.", upcoming);

  // Neither open nor upcoming: every window has ended (an open-ended window would still be open).
  const ended = windows.filter((w): w is { opensAt: Date; closesAt: Date } => w.closesAt !== null);
  const last = ended.sort((a, b) => b.closesAt.getTime() - a.closesAt.getTime())[0];
  if (!last) return result("CLOSED", source, "Opens only when staff open it (no schedule set).");
  return progress === "NOT_STARTED"
    ? result("MISSED", source, "The scheduled window has passed.", last)
    : result("CLOSED", source, "The scheduled window has passed.", last);
}

const latest = (dates: Date[]) => new Date(Math.max(...dates.map((d) => d.getTime())));

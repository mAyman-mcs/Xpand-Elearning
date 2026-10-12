import type { AvailabilityStatus, ExamStatus, Progress, Role, ScheduleMode, UserDetail } from "@contracts";
import type { BadgeTone } from "../components/ui";

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  INSTRUCTOR: "Instructor",
  STUDENT: "Student",
};

export const ROLE_TONE: Record<Role, BadgeTone> = { SUPER_ADMIN: "red", INSTRUCTOR: "blue", STUDENT: "gray" };

/** Account state for badges: deactivated, locked after failed logins, or active. */
export function accountState(u: Pick<UserDetail, "isActive" | "lockedUntil">, now = new Date()) {
  if (!u.isActive) return { label: "Deactivated", tone: "gray" as BadgeTone };
  if (u.lockedUntil && new Date(u.lockedUntil) > now) return { label: "Locked", tone: "amber" as BadgeTone };
  return { label: "Active", tone: "green" as BadgeTone };
}

export const EXAM_STATUS: Record<ExamStatus, { label: string; tone: BadgeTone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  PUBLISHED: { label: "Published", tone: "green" },
  ARCHIVED: { label: "Archived", tone: "amber" },
};

export const AVAILABILITY: Record<AvailabilityStatus, { label: string; tone: BadgeTone }> = {
  NOT_ASSIGNED: { label: "Not assigned", tone: "gray" },
  SCHEDULED: { label: "Scheduled", tone: "blue" },
  OPEN: { label: "Open", tone: "green" },
  CLOSED: { label: "Closed", tone: "gray" },
  MISSED: { label: "Missed", tone: "red" },
  SUBMITTED: { label: "Submitted", tone: "teal" },
  EXTERNAL: { label: "External", tone: "amber" },
};

export const PROGRESS: Record<Progress, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  ANSWERED: "Answered",
  UNDER_REVIEW: "Under review",
  REVIEWED: "Reviewed",
};

export const SCHEDULE_MODE: Record<ScheduleMode, string> = {
  FIXED: "Fixed dates",
  RELATIVE: "Relative to join date",
  MANUAL: "Manual (opened by staff)",
};

// The JSON shapes of API responses, shared with the web app (docs/ADMIN_DASHBOARD_PLAN.md, A-D4).
//
// Plain types with NO imports: the web imports this file type-only, so nothing from the server
// reaches the browser bundle. Instants are ISO strings, calendar dates "YYYY-MM-DD".
// contracts.check.ts proves at compile time that the server's response builders produce exactly
// these shapes, so a renamed field breaks `npm run typecheck`, not production.

export type Role = "SUPER_ADMIN" | "INSTRUCTOR" | "STUDENT";

export type Permission =
  | "EXAM_EDIT"
  | "EXAM_ASSIGN"
  | "EXAM_SCHEDULE"
  | "RESULTS_VIEW"
  | "RESULTS_RELEASE"
  | "PROCTOR"
  | "ATTEMPT_VOID"
  | "ATTEMPT_REVIEW"
  | "AUDIT_VIEW";

export type ExamStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type ScheduleMode = "FIXED" | "RELATIVE" | "MANUAL";
export type OverrideAction = "OPEN" | "CLOSE";
export type AvailabilityStatus = "NOT_ASSIGNED" | "SCHEDULED" | "OPEN" | "CLOSED" | "MISSED" | "SUBMITTED" | "EXTERNAL";
export type Progress = "NOT_STARTED" | "IN_PROGRESS" | "ANSWERED" | "UNDER_REVIEW" | "REVIEWED";

/** Every error body. */
export interface ApiErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}

/** Cursor-paginated lists. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ─────────────────────────────── People ───────────────────────────────

/** The logged-in user (login, /auth/me, change-password). */
export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  role: Role;
  mustChangePassword: boolean;
}

export interface UserDetail extends SessionUser {
  isActive: boolean;
  /** After failed logins: the account is locked while this instant is in the future. */
  lockedUntil: string | null;
  joinDate: string | null;
  groups: { id: string; name: string; joinDate: string | null }[];
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  intakeStartDate: string;
  memberCount: number;
}

export interface GroupMember {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  /** Late-joiner override; null = the group's intake date. */
  joinDate: string | null;
  effectiveJoinDate: string;
}

export interface GroupDetail extends Group {
  members: GroupMember[];
}

// ─────────────────────────────── Access ───────────────────────────────

export interface GrantScopeFields {
  permissions: Permission[];
  allExams: boolean;
  examIds: string[];
  categoryIds: string[];
  /** Exams carrying ANY of these tags. */
  tagIds: string[];
  /** Student scope: exactly one of allGroups, groupIds (non-empty), studentsWhoSubmitted. */
  allGroups: boolean;
  groupIds: string[];
  /** Only students who have submitted an exam this grant covers. */
  studentsWhoSubmitted: boolean;
  expiresAt: string | null;
}

export interface Grant extends GrantScopeFields {
  id: string;
  userId: string;
  user: { username: string; fullName: string };
  active: boolean;
  createdAt: string;
  createdById: string | null;
}

export interface MyPermissions {
  role: Role;
  grants: GrantScopeFields[];
}

// ─────────────────────────────── Catalog ───────────────────────────────

export interface Category {
  id: string;
  name: string;
  slug: string;
  position: number;
  archived: boolean;
  examCount?: number;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  examCount?: number;
  /** Grants using this tag: more than 0 makes it an access tag (only super admins attach or remove it). */
  grantCount?: number;
}

export interface Exam {
  id: string;
  code: string;
  title: string;
  status: ExamStatus;
  category: { id: string; name: string; slug: string };
  tags: { id: string; name: string; slug: string }[];
  durationMinutes: number;
  passMark: number;
  weight: number;
  maxAttempts: number;
  isExternal: boolean;
  allowBackNavigation: boolean;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  questionsPerAttempt: number | null;
  strikeLimit: number;
  requireFullscreen: boolean;
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────── Assignment and scheduling ────────────────────────

export type Target =
  { type: "user"; id: string; name: string; username: string } | { type: "group"; id: string; name: string };

export interface Schedule {
  mode: ScheduleMode;
  opensAt: string | null;
  closesAt: string | null;
  offsetDays: number | null;
  openTime: string | null;
  windowMinutes: number | null;
}

export interface Assignment {
  id: string;
  examId: string;
  target: Target;
  schedule: Schedule;
  createdAt: string;
  createdById: string | null;
}

export interface Override {
  id: string;
  examId: string;
  target: Target;
  action: OverrideAction;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
  reason: string | null;
  createdAt: string;
  createdById: string | null;
}

export interface PersonRef {
  id: string;
  username: string;
  fullName: string;
}

export interface PreviewRow {
  examId: string;
  examTitle: string;
  student: PersonRef;
  anchorDate: string | null;
  opensAt: string | null;
  closesAt: string | null;
  replacedByPersonalAssignment: boolean;
}

export interface AvailabilityRow {
  student: PersonRef;
  status: AvailabilityStatus;
  progress: Progress;
  opensAt: string | null;
  closesAt: string | null;
  source: string;
  reason: string;
}

export interface StudentExamRow {
  exam: {
    id: string;
    code: string;
    title: string;
    category: { id: string; name: string; slug: string };
    tags: { id: string; name: string; slug: string }[];
    durationMinutes: number;
    isExternal: boolean;
    materials: { title: string; url: string }[];
  };
  status: AvailabilityStatus;
  progress: Progress;
  opensAt: string | null;
  closesAt: string | null;
  reason: string;
}

// ─────────────────────────────── Admin ───────────────────────────────

export interface AdminStats {
  users: { students: number; instructors: number; admins: number; inactive: number; locked: number };
  groups: number;
  exams: { draft: number; published: number; archived: number };
  assignments: number;
  activeOverrides: number;
  activeSessions: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: PersonRef | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: unknown;
  ip: string | null;
}

export interface UserLookup extends PersonRef {
  role: Role;
}

export interface ImportResult {
  dryRun: boolean;
  /** `row` is the 1-based data row (CSV line = row + 1). */
  errors: { row: number; field: string; message: string }[];
  summary: { users: number; newGroups: string[]; existingGroups: string[] };
  /** Real run only: each temporary password, shown once. */
  created: { username: string; fullName: string; temporaryPassword: string }[];
}

// ─────────────────────────────── Exam content (staff only) ───────────────────────────────

export type QuestionType = "SINGLE_CHOICE" | "MULTI_CHOICE" | "TRUE_FALSE";

/** A question WITH its answer key: staff screens only. */
export interface StaffQuestion {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  points: number;
  position: number;
  options: { id: string; text: string; isCorrect: boolean; position: number }[];
}

export interface QuestionList {
  /** Students have taken the exam: only wording can change. */
  locked: boolean;
  questions: StaffQuestion[];
  /** Why it can't be published yet (empty = ready). */
  publishProblems: string[];
}

export interface QuestionImportResult {
  dryRun: boolean;
  /** `index` is the 1-based position in the imported list (0 = the whole import). */
  errors: { index: number; message: string }[];
  imported: number;
  questions: StaffQuestion[];
}

export interface Material {
  id: string;
  title: string;
  url: string;
  position: number;
}

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
/** MCQ: choice questions only. MCQ_ESSAY: may also contain essays (always MANUAL_APPROVAL). */
export type ExamType = "MCQ" | "MCQ_ESSAY";
/** AUTO: scored on submit. MANUAL_APPROVAL: scored when a grader approves the attempt. */
export type ScoringMode = "AUTO" | "MANUAL_APPROVAL";
export type ReviewStatus = "PENDING" | "UNDER_REVIEW" | "REVIEWED";
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
  type: ExamType;
  scoringMode: ScoringMode;
  /** Shown to students before and during the exam. */
  intro: string | null;
  /** Case hints are sent to students. */
  showHints: boolean;
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
    /** MANUAL_APPROVAL: a submitted attempt waits for grading before it has a score. */
    scoringMode: ScoringMode;
    /** Percent of the maximum score needed to pass. */
    passMark: number;
    materials: { title: string; url: string }[];
  };
  status: AvailabilityStatus;
  progress: Progress;
  opensAt: string | null;
  closesAt: string | null;
  reason: string;
  /** Only once staff have released this exam's results (and, for MANUAL_APPROVAL, approved the attempt). */
  result: { score: number; maxScore: number } | null;
}

// ─────────────────────────────── Exam session (students) ───────────────────────────────

export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "AUTO_SUBMITTED" | "FORCE_SUBMITTED" | "VOIDED";

/** The pre-check page of one exam. */
export interface StudentExamBrief {
  exam: {
    id: string;
    code: string;
    title: string;
    durationMinutes: number;
    questionCount: number;
    strikeLimit: number;
    requireFullscreen: boolean;
    allowBackNavigation: boolean;
    isExternal: boolean;
    intro: string | null;
    materials: { title: string; url: string }[];
  };
  status: AvailabilityStatus;
  progress: Progress;
  opensAt: string | null;
  closesAt: string | null;
  reason: string;
  inProgressAttemptId: string | null;
}

/** ESSAY questions: a one-line answer (at most 300 characters) or a text area (10,000). */
export type AnswerSize = "SHORT" | "LONG";

/** A use case as delivered: one situation shared by its questions (docs/CASE_QUESTIONS_PLAN.md). */
export interface StudentCase {
  id: string;
  /** Short chip, e.g. KNOWLEDGE, DESIGN. */
  label: string | null;
  title: string;
  situation: string;
  /** Null unless the exam shows hints (graders always see it). */
  hint: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
}

/** An option as a student receives it: text and/or a picture, never whether it is correct. */
export interface StudentOption {
  id: string;
  /** May be empty when the option is a picture. */
  text: string;
  detail: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
}

/** A question as a student receives it: never the answer key. */
export interface StudentQuestion {
  /** Position in this attempt (0-based); without back navigation, earlier ones aren't sent. */
  index: number;
  id: string;
  type: QuestionType;
  /** The case it belongs to (in `cases`); its questions are consecutive and options keep their letters. */
  caseId: string | null;
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  points: number;
  answerSize: AnswerSize;
  options: StudentOption[];
}

export interface StudentAttempt {
  attemptId: string;
  status: AttemptStatus;
  exam: {
    id: string;
    code: string;
    title: string;
    allowBackNavigation: boolean;
    requireFullscreen: boolean;
    strikeLimit: number;
    intro: string | null;
  };
  /** For the watermark. */
  student: { fullName: string; username: string };
  startedAt: string;
  /** The server's deadline; the browser timer only displays it. */
  deadlineAt: string | null;
  /** The server's clock when answering, to correct the browser's clock. */
  serverNow: string;
  strikes: number;
  furthestIndex: number;
  questionCount: number;
  /** The cases of the questions sent, in delivery order. */
  cases: StudentCase[];
  questions: StudentQuestion[];
  /** questionId → selected option ids, as saved on the server (choice questions). */
  answers: Record<string, string[]>;
  /** questionId → essay text, as saved on the server (essay questions). */
  essays: Record<string, string>;
}

export interface AttemptOutcome {
  attemptId: string;
  examTitle: string;
  status: AttemptStatus;
  submittedAt: string | null;
  submitReason: string | null;
  /** Submitted, but the score is set only when a grader approves it. */
  awaitingGrading: boolean;
  result: { score: number; maxScore: number } | null;
}

export interface EventResult {
  strikes: number;
  strikeLimit: number;
  /** WARN: a strike (show the warning); AUTO_SUBMITTED: the limit was reached; LOGGED: recorded only; ENDED: the attempt is over. */
  action: "WARN" | "AUTO_SUBMITTED" | "LOGGED" | "ENDED";
  status: AttemptStatus;
}

export interface HeartbeatResult {
  active: boolean;
  status: AttemptStatus;
  deadlineAt: string | null;
  serverNow: string;
  strikes: number;
}

// ─────────────────────────────── Admin ───────────────────────────────

export interface AdminStats {
  users: { students: number; instructors: number; admins: number; inactive: number; locked: number };
  groups: number;
  exams: { draft: number; published: number; archived: number };
  assignments: number;
  activeOverrides: number;
  activeSessions: number;
  today: { examsRunning: number; attemptsInProgress: number; awaitingGrading: number; submittedToday: number };
  attention: { lockedAccounts: number; publishedUnassigned: number };
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

export type QuestionType = "SINGLE_CHOICE" | "MULTI_CHOICE" | "TRUE_FALSE" | "ESSAY";

export interface StaffOption {
  id: string;
  /** May be empty when the option is a picture. */
  text: string;
  /** A neutral second line students see under the text. */
  detail: string | null;
  /** An uploaded picture: GET /api/uploads/:imageId. */
  imageId: string | null;
  imageAlt: string | null;
  isCorrect: boolean;
  /** Why it is right or wrong: staff only. */
  explanation: string | null;
  position: number;
}

/** A question WITH its answer key: staff screens only. */
export interface StaffQuestion {
  id: string;
  type: QuestionType;
  text: string;
  /** An outside https link (older questions). */
  imageUrl: string | null;
  /** An uploaded picture: GET /api/uploads/:imageId. */
  imageId: string | null;
  imageAlt: string | null;
  points: number;
  /** Position in the exam (0-based); a case's questions are consecutive. */
  position: number;
  /** ESSAY only: notes for graders. */
  guidance: string | null;
  answerSize: AnswerSize;
  caseId: string | null;
  options: StaffOption[];
}

/** A use case: a situation shared by a choice question and its written follow-ups. */
export interface StaffCase {
  id: string;
  label: string | null;
  title: string;
  situation: string;
  hint: string | null;
  imageId: string | null;
  imageAlt: string | null;
}

export interface QuestionList {
  /** Students have taken the exam: only wording can change. */
  locked: boolean;
  questions: StaffQuestion[];
  /** Every case of the exam (a case without questions is not placed yet). */
  cases: StaffCase[];
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

/** POST /api/uploads?examId=… with the picture as the body. */
export interface UploadResult {
  id: string;
  url: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}

export interface Material {
  id: string;
  title: string;
  url: string;
  position: number;
}

// ─────────────────────────────── Grading (staff only) ───────────────────────────────

/** One finished attempt of a MANUAL_APPROVAL exam in the grading queue. */
export interface GradingQueueRow {
  attemptId: string;
  attemptNo: number;
  student: PersonRef;
  status: AttemptStatus;
  submittedAt: string | null;
  reviewStatus: ReviewStatus;
  /** Answered essays, and how many of them have points. */
  essays: { answered: number; graded: number };
  /** Set only once approved. */
  score: number | null;
  maxScore: number | null;
  lastGradedBy: PersonRef | null;
  lastGradedAt: string | null;
}

export interface GradingQueue extends Page<GradingQueueRow> {
  /** Over every attempt in the caller's scope (not only this page or filter). */
  counts: { pending: number; underReview: number; reviewed: number };
}

/** One delivered question with the student's answer and its grading. */
export interface GradingQuestion {
  /** Position in the attempt (0-based). */
  index: number;
  id: string;
  type: QuestionType;
  caseId: string | null;
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  points: number;
  guidance: string | null;
  answerSize: AnswerSize;
  /** Choice questions: in the order the student saw them (so letters match). */
  options: (StudentOption & { isCorrect: boolean; explanation: string | null; selected: boolean })[];
  /** Essays: the student's text (null = not answered). */
  answerText: string | null;
  answered: boolean;
  autoPoints: number | null;
  awardedPoints: number | null;
  overrideReason: string | null;
  feedback: string | null;
  gradedBy: PersonRef | null;
  gradedAt: string | null;
}

export interface GradingAttempt {
  attemptId: string;
  attemptNo: number;
  status: AttemptStatus;
  submittedAt: string | null;
  submitReason: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: PersonRef | null;
  reviewedAt: string | null;
  /** Send back with every grading change (optimistic locking). */
  gradingVersion: number;
  score: number | null;
  maxScore: number | null;
  exam: { id: string; code: string; title: string; scoringMode: ScoringMode };
  student: PersonRef;
  cases: StudentCase[];
  questions: GradingQuestion[];
  /** What still blocks approval (empty = it can be approved). */
  approvalProblems: string[];
  /** The next attempt of this exam, in scope, that isn't approved yet. */
  nextUngradedId: string | null;
}

// ─────────────────────────────── Submissions & staff dashboard ───────────────────────────────

/** One submitted exam in the cross-exam submissions list (staff, within their scope). */
export interface SubmissionRow {
  attemptId: string;
  attemptNo: number;
  /** The student's latest attempt on this exam (only that one can get another attempt). */
  isLatest: boolean;
  exam: { id: string; code: string; title: string; scoringMode: ScoringMode };
  student: PersonRef;
  status: AttemptStatus;
  submittedAt: string | null;
  reviewStatus: ReviewStatus;
  /** A needs-approval exam that isn't approved yet. */
  awaitingGrading: boolean;
  score: number | null;
  maxScore: number | null;
}

/** A submitted exam, read only (any scoring mode). */
export interface SubmissionPreview extends Omit<GradingAttempt, "nextUngradedId"> {
  canGrade: boolean;
  canGiveAnotherAttempt: boolean;
}

/** GET /api/me/dashboard: counts within the caller's own scope (zeros without grants). */
export interface StaffDashboard {
  exams: number;
  students: number;
  submissions: { total: number; awaitingGrading: number; lastWeek: number };
}

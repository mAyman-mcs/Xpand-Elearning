// Typed functions for every API endpoint the web app uses (docs/API.md). Screens call these through
// TanStack Query hooks; nothing else calls fetch.
import type {
  AdminStats,
  AttemptOutcome,
  AttemptStatus,
  EventResult,
  HeartbeatResult,
  StudentAttempt,
  StudentExamBrief,
  StudentExamRow,
  Assignment,
  AuditEntry,
  AvailabilityRow,
  Category,
  Exam,
  ExamStatus,
  Grant,
  GrantScopeFields,
  Group,
  GroupDetail,
  ImportResult,
  Material,
  MyPermissions,
  Override,
  OverrideAction,
  Page,
  PreviewRow,
  QuestionImportResult,
  QuestionList,
  QuestionType,
  StaffQuestion,
  Role,
  SessionUser,
  Tag,
  UserDetail,
  UserLookup,
} from "@contracts";
import { http } from "./client";

export { ApiError, setSessionEndedHandler } from "./client";
export { errorMessage, fieldErrors } from "./errors";

// ─────────────────────────────── Inputs ───────────────────────────────

export type TargetInput = { userId: string } | { groupId: string };

export type ScheduleInput =
  | { mode: "FIXED"; opensAt: string; closesAt: string | null }
  | { mode: "RELATIVE"; offsetDays: number; openTime: string; windowMinutes: number }
  | { mode: "MANUAL" };

export interface UserInput {
  username: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  role: Role;
  joinDate: string | null;
  groupIds: string[];
}
export type UserPatch = Partial<Pick<UserDetail, "fullName" | "email" | "mobile" | "role" | "isActive" | "joinDate">>;

export interface ExamSettings {
  title: string;
  categoryId: string;
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
}
export type ExamInput = ExamSettings & { code: string; tagIds: string[] };
export type ExamPatch = Partial<ExamSettings> & { status?: ExamStatus };

export type ExamSelection = { examIds: string[] } | { categoryId: string } | { tagIds: string[] };
export type BulkInput = ExamSelection & { targets: TargetInput[]; schedule: ScheduleInput };

export interface OverrideInput {
  examId: string;
  target: TargetInput;
  action: OverrideAction;
  validFrom?: string;
  validUntil: string | null;
  reason: string;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  points: number;
  options: { id?: string; text: string; isCorrect: boolean }[];
}

export interface UserListFilter {
  role?: Role;
  groupId?: string;
  q?: string;
  includeInactive?: boolean;
}
export interface AuditFilter {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
}
export interface ExamListFilter {
  categoryId?: string;
  tagIds?: string[];
  status?: ExamStatus;
  q?: string;
}

// ─────────────────────────────── Endpoints ───────────────────────────────

export const api = {
  auth: {
    me: () => http.get<{ user: SessionUser }>("/auth/me"),
    login: (username: string, password: string) =>
      http.post<{ user: SessionUser }>("/auth/login", { username, password }),
    logout: () => http.post<void>("/auth/logout"),
    changePassword: (currentPassword: string, newPassword: string) =>
      http.post<{ user: SessionUser }>("/auth/change-password", { currentPassword, newPassword }),
  },
  me: {
    permissions: () => http.get<MyPermissions>("/me/permissions"),
  },
  users: {
    list: (filter: UserListFilter, cursor?: string) =>
      http.get<Page<UserDetail>>("/users", { ...filter, cursor, limit: 50 }),
    get: (id: string) => http.get<UserDetail>(`/users/${id}`),
    create: (input: UserInput) => http.post<{ user: UserDetail; temporaryPassword: string }>("/users", input),
    update: (id: string, patch: UserPatch) => http.patch<UserDetail>(`/users/${id}`, patch),
    resetPassword: (id: string) => http.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
    lookup: (q: string, role?: Role) => http.get<UserLookup[]>("/users/lookup", { q, role, limit: 20 }),
    import: (rows: Record<string, string>[], dryRun: boolean) =>
      http.post<ImportResult>("/users/import", { rows, dryRun }),
  },
  groups: {
    list: () => http.get<Group[]>("/groups"),
    get: (id: string) => http.get<GroupDetail>(`/groups/${id}`),
    create: (input: { name: string; intakeStartDate: string }) => http.post<Group>("/groups", input),
    update: (id: string, patch: { name?: string; intakeStartDate?: string }) =>
      http.patch<Group>(`/groups/${id}`, patch),
    addMembers: (id: string, userIds: string[], joinDate: string | null) =>
      http.post<GroupDetail>(`/groups/${id}/members`, { userIds, joinDate }),
    setMemberJoinDate: (id: string, userId: string, joinDate: string | null) =>
      http.patch<GroupDetail>(`/groups/${id}/members/${userId}`, { joinDate }),
    removeMember: (id: string, userId: string) => http.del(`/groups/${id}/members/${userId}`),
  },
  grants: {
    list: (userId?: string) => http.get<Grant[]>("/rbac/grants", { userId }),
    create: (input: GrantScopeFields & { userId: string }) => http.post<Grant>("/rbac/grants", input),
    update: (id: string, patch: Partial<GrantScopeFields>) => http.patch<Grant>(`/rbac/grants/${id}`, patch),
    remove: (id: string) => http.del(`/rbac/grants/${id}`),
  },
  categories: {
    list: (includeArchived = false) => http.get<Category[]>("/catalog/categories", { includeArchived }),
    create: (input: { name: string; position?: number }) => http.post<Category>("/catalog/categories", input),
    update: (id: string, patch: { name?: string; position?: number; archived?: boolean }) =>
      http.patch<Category>(`/catalog/categories/${id}`, patch),
    remove: (id: string) => http.del(`/catalog/categories/${id}`),
  },
  tags: {
    list: () => http.get<Tag[]>("/catalog/tags"),
    create: (name: string) => http.post<Tag>("/catalog/tags", { name }),
    rename: (id: string, name: string) => http.patch<Tag>(`/catalog/tags/${id}`, { name }),
    remove: (id: string) => http.del(`/catalog/tags/${id}`),
  },
  exams: {
    list: (filter: ExamListFilter, cursor?: string) =>
      http.get<Page<Exam> & { total: number }>("/catalog/exams", { ...filter, cursor, limit: 50 }),
    get: (id: string) => http.get<Exam>(`/catalog/exams/${id}`),
    create: (input: ExamInput) => http.post<Exam>("/catalog/exams", input),
    update: (id: string, patch: ExamPatch) => http.patch<Exam>(`/catalog/exams/${id}`, patch),
    setTags: (id: string, tagIds: string[]) => http.put<Exam>(`/catalog/exams/${id}/tags`, { tagIds }),
    duplicate: (id: string, code: string, title?: string) =>
      http.post<{ id: string }>(`/catalog/exams/${id}/duplicate`, { code, title }),
  },
  questions: {
    list: (examId: string) => http.get<QuestionList>(`/catalog/exams/${examId}/questions`),
    create: (examId: string, input: QuestionInput) =>
      http.post<StaffQuestion>(`/catalog/exams/${examId}/questions`, input),
    update: (id: string, patch: Partial<QuestionInput>) => http.patch<StaffQuestion>(`/catalog/questions/${id}`, patch),
    remove: (id: string) => http.del(`/catalog/questions/${id}`),
    reorder: (examId: string, questionIds: string[]) =>
      http.put<StaffQuestion[]>(`/catalog/exams/${examId}/questions/order`, { questionIds }),
    import: (examId: string, questions: unknown[], dryRun: boolean) =>
      http.post<QuestionImportResult>(`/catalog/exams/${examId}/questions/import`, { questions, dryRun }),
  },
  materials: {
    list: (examId: string) => http.get<Material[]>(`/catalog/exams/${examId}/materials`),
    create: (examId: string, input: { title: string; url: string }) =>
      http.post<Material>(`/catalog/exams/${examId}/materials`, input),
    update: (id: string, patch: { title?: string; url?: string }) =>
      http.patch<Material>(`/catalog/materials/${id}`, patch),
    remove: (id: string) => http.del(`/catalog/materials/${id}`),
  },
  assignments: {
    list: (examId: string) => http.get<Assignment[]>("/assignments", { examId }),
    create: (input: { examId: string; target: TargetInput; schedule: ScheduleInput }) =>
      http.post<Assignment>("/assignments", input),
    reschedule: (id: string, schedule: ScheduleInput) => http.patch<Assignment>(`/assignments/${id}`, { schedule }),
    remove: (id: string) => http.del(`/assignments/${id}`),
    bulk: (input: BulkInput) => http.post<{ created: number }>("/assignments/bulk", input),
    preview: (input: BulkInput) => http.post<PreviewRow[]>("/assignments/preview", input),
    availability: (examId: string) => http.get<AvailabilityRow[]>("/assignments/availability", { examId }),
  },
  admin: {
    stats: () => http.get<AdminStats>("/admin/stats"),
  },
  audit: {
    list: (filter: AuditFilter, cursor?: string) =>
      http.get<Page<AuditEntry>>("/audit", { ...filter, cursor, limit: 50 }),
    actions: () => http.get<string[]>("/audit/actions"),
  },
  student: {
    exams: () => http.get<StudentExamRow[]>("/student/exams"),
    exam: (id: string) => http.get<StudentExamBrief>(`/student/exams/${id}`),
  },
  attempts: {
    start: (examId: string) => http.post<StudentAttempt>("/attempts", { examId }),
    get: (id: string) => http.get<StudentAttempt>(`/attempts/${id}`),
    outcome: (id: string) => http.get<AttemptOutcome>(`/attempts/${id}/outcome`),
    save: (id: string, questionId: string, selectedOptionIds: string[]) =>
      http.put<{ questionId: string; savedAt: string }>(`/attempts/${id}/answers/${questionId}`, {
        selectedOptionIds,
      }),
    moveTo: (id: string, index: number) => http.post<{ furthestIndex: number }>(`/attempts/${id}/position`, { index }),
    event: (
      id: string,
      input: { type: string; detail?: Record<string, string | number | boolean>; clientTime: string },
    ) => http.post<EventResult>(`/attempts/${id}/events`, input),
    heartbeat: (id: string) => http.post<HeartbeatResult>(`/attempts/${id}/heartbeat`),
    submit: (id: string) => http.post<{ status: AttemptStatus; submittedAt: string | null }>(`/attempts/${id}/submit`),
  },
  overrides: {
    list: (examId: string, includeEnded: boolean) => http.get<Override[]>("/overrides", { examId, includeEnded }),
    create: (input: OverrideInput) => http.post<Override>("/overrides", input),
    end: (id: string) => http.post<Override>(`/overrides/${id}/end`),
  },
};

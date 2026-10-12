// Compile-time proof that the server's response builders produce exactly the shapes in
// contracts.ts (after JSON serialization). Nothing here runs; `npm run typecheck` fails on drift.
import type * as C from "./contracts.js";
import type { Page } from "./core/pagination.js";
import type { adminStats, listAudit } from "./modules/admin/service.js";
import type { assignmentDto, previewAssignments } from "./modules/assignments/assignments.service.js";
import type { examAvailability, studentExams } from "./modules/assignments/availability.service.js";
import type { overrideDto } from "./modules/assignments/overrides.service.js";
import type { publicUser } from "./modules/auth/service.js";
import type { examDto } from "./modules/catalog/exams.service.js";
import type { categoryDto, tagDto } from "./modules/catalog/taxonomy.service.js";
import type { getGroup, groupDto } from "./modules/groups/service.js";
import type { grantDto } from "./modules/rbac/grants.service.js";
import type { userDto } from "./modules/users/service.js";

/** What JSON.stringify makes of a value: Dates become ISO strings. */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

/** Mutually assignable: neither side has a field (or a type) the other lacks. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Out<F extends (...args: never[]) => unknown> = Wire<Awaited<ReturnType<F>>>;
type Item<F extends (...args: never[]) => unknown> = Out<F> extends (infer U)[] ? U : never;

export type Checks = [
  Assert<Same<Out<typeof publicUser>, C.SessionUser>>,
  Assert<Same<Out<typeof userDto>, C.UserDetail>>,
  Assert<Same<Out<typeof groupDto>, C.Group>>,
  Assert<Same<Out<typeof getGroup>, C.GroupDetail>>,
  Assert<Same<Out<typeof grantDto>, C.Grant>>,
  Assert<Same<Out<typeof categoryDto>, C.Category>>,
  Assert<Same<Out<typeof tagDto>, C.Tag>>,
  Assert<Same<Out<typeof examDto>, C.Exam>>,
  Assert<Same<Out<typeof assignmentDto>, C.Assignment>>,
  Assert<Same<Out<typeof overrideDto>, C.Override>>,
  Assert<Same<Item<typeof previewAssignments>, C.PreviewRow>>,
  Assert<Same<Item<typeof examAvailability>, C.AvailabilityRow>>,
  Assert<Same<Item<typeof studentExams>, C.StudentExamRow>>,
  Assert<Same<Wire<Page<C.Exam>>, C.Page<C.Exam>>>,
  Assert<Same<Out<typeof adminStats>, C.AdminStats>>,
  Assert<Same<Out<typeof listAudit>, C.Page<C.AuditEntry>>>,
];

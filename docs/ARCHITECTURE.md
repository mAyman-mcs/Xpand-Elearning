# Xpand CS Academy portal: architecture

Replaces the Google Apps Script prototype (`frontend.html`, `frontend.js`, `portal.json`, `test/`). The prototype stays in the repo as a reference until the new app reaches feature parity.

Status: backend phases B0–B4 of [BACKEND_PLAN.md](BACKEND_PLAN.md) are done (foundations, access control, catalog, assignment and scheduling, infrastructure). The exam session itself (attempts, anti-cheat, proctoring) is next: see [NEXT_PLAN.md](NEXT_PLAN.md).

## Stack

| Layer | Choice |
|---|---|
| Backend | Node 24, TypeScript 6 (strict), Express 5, Zod 4, pino |
| Database | PostgreSQL 17 through Prisma 7 (`@prisma/adapter-pg`) |
| Frontend | React 19, Vite, Tailwind 4 |
| Tests | Vitest (unit + integration projects), supertest, fast-check |
| Deployment | A runtime image (API + built web app) behind Caddy (HTTPS), a one-shot `migrate` image, and Postgres, via `docker-compose.yml` on EC2 ([DEPLOY.md](DEPLOY.md)) |

## Code layout

```
server/src/
  app.ts            createApp(deps): the module list, middleware, and the API route table
  index.ts          reads config, builds dependencies, starts the server
  core/             shared building blocks, no business rules
    route.ts          ApiRouter: every route declares access + input schemas (see below)
    context.ts        AppDeps (config, db, logger, clock) and Ctx (what services receive)
    errors.ts         AppError and THE list of error codes; the single error handler
    audit.ts          audit(tx, …) inside the change's transaction
    time.ts           the only Cairo ↔ UTC conversion (daylight saving aware)
    db.ts, config.ts, logger.ts, pagination.ts, schemas.ts, dates.ts, lib/
  modules/          one folder per feature: routes.ts (HTTP only) + *.service.ts (rules) + tests
    auth/ health/ rbac/ users/ groups/ catalog/ assignments/
  test/             test app, factories, the RBAC world and matrix helpers
server/prisma/      schema.prisma and SQL migrations (with hand-written constraints)
server/scripts/     create-super-admin, import-users (compiled into the image)
web/src/            React app
ops/                Caddyfile, backup.sh, restore-test.sh
```

**Conventions:**
- Routes are thin: they validate, check access, call one service function, and send the result.
- Services take a `Ctx` (`db`, `now`, `actor`, `ip`, `logger`), so tests pass a fixed clock or a transaction instead of mocking globals.
- Business rules that can be pure functions are pure, and carry most of the tests: `authorize`, the list filters in `rbac/scope.ts`, and `resolveAvailability`.

## Routes and access policies

API routes are registered only through `ApiRouter`, for example:

```ts
api.patch("/exams/:id", {
  access: access.permission("EXAM_EDIT"),             // or public / authenticated / roles(...) / anyPermission()
  params: idParams, body: updateExamBody,              // Zod schemas → typed input; 400 VALIDATION_FAILED
  scope: (ctx, { params }) => examScope(ctx.db, params.id),  // what the request touches
  handler: (ctx, { params, body }) => updateExam(ctx, params.id, body),
});
```

The router checks in this order:
1. Who the caller is: logged in, not forced to change their password, the right role. Students are refused on staff permission routes before any lookup.
2. The input, against the schemas.
3. The scope (exam, category, groups) and the permission.

The order matters: anonymous callers and students learn nothing about input formats or which IDs exist.

Two tests guard the routing:
- **Route coverage:** a unit test proves every Express route carries a policy.
- **RBAC matrix completeness:** a test proves every non-public route has rows in the access matrix (see Testing).

## Authentication

- Passwords are hashed with bcrypt (cost 12 in production). Imported and created accounts get a random temporary password and must change it at first login.
- Login returns one generic error for an unknown user, a wrong password or a deactivated account, and runs a hash comparison even when the user doesn't exist, so timing reveals nothing.
- 5 failed attempts lock the account for 15 minutes; the login route is also rate limited per IP.
- Sessions are opaque 256-bit tokens in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Only the SHA-256 of the token is stored.
- Sessions end after 20 idle minutes or 12 hours, whichever comes first, enforced on the server.
- Changing the password signs out every other session. A role change, deactivation or password reset by an admin signs out all of that user's sessions.
- CSRF: state-changing API calls must be `application/json`, on top of the SameSite cookie.

## Access control

Roles: `SUPER_ADMIN`, `INSTRUCTOR`, `STUDENT`.

An instructor's rights come from **grants**. A grant combines:
- a set of permissions;
- an exam scope: all exams, OR listed exams, OR exams in listed **categories** (this includes exams created later);
- a group scope: all groups, OR listed groups;
- an optional expiry date.

Permissions: `EXAM_EDIT`, `EXAM_ASSIGN`, `EXAM_SCHEDULE`, `RESULTS_VIEW`, `RESULTS_RELEASE`, `PROCTOR`, `ATTEMPT_VOID`, `ATTEMPT_REVIEW`, `AUDIT_VIEW`.

`authorize(principal, permission, { examId?, categoryId?, groupIds? }, now)`:
- A super admin is always allowed; a student never is (students' own data is checked by ownership).
- An instructor needs **one** unexpired grant that has the permission and covers both the exam and the group(s). Scopes from different grants are never combined: exam A × group X plus exam B × group Y does not allow A × Y.
- A student is in a grant's group scope when **any** of their groups is listed. A student in no group is reachable only by all-groups grants.

List queries use `rbac/scope.ts`. It turns a principal into exam × group pairs (one per grant) and builds the Prisma `where` clauses from them (`examWhere`, `groupWhere`, `studentWhere`, `targetWhere`, `reachForExam`). Randomized tests check these filters against `authorize()` row by row, both in memory and against the database.

**404 vs 403:** a resource outside everything the caller can reach answers 404, the same as a missing one, so its existence isn't revealed. 403 means "you can see it, but you can't do this".

Grant changes take effect on the instructor's next request, because grants are loaded per request.

## Catalog

- **Categories:** a flat list, and every exam has exactly one. A category can't be deleted while exams use it; archive it instead (it's hidden from pickers and new exams can't use it). Renaming keeps the slug stable.
- **Tags:** cross-cutting labels managed by super admins. Instructors with `EXAM_EDIT` attach existing tags. Names of both are unique regardless of case; names without Latin letters get a short random slug.
- **Exams:** status is `DRAFT` (never shown to students), `PUBLISHED` or `ARCHIVED`.
  - Moving an exam to another category requires `EXAM_EDIT` on both categories, because it changes who reaches the exam through category grants.
  - The exam list applies filters inside the scope: category, all-of tags, status and text search.

## Assignment and scheduling

- An `Assignment` makes an exam visible to **one user or one group**. A database CHECK enforces exactly one target, and a unique index allows each exam to be assigned to a target only once.
  - `FIXED`: `opensAt` to `closesAt` (open-ended when `closesAt` is null).
  - `RELATIVE`: anchor date + `offsetDays`, at `openTime` in Cairo time, open for `windowMinutes`. The anchor is the member's own join date, or else the group's intake date; for a personal assignment, the user's join date.
  - `MANUAL`: visible, but opens only through an override.
- An `AccessOverride` opens or closes an exam for a user or group, optionally until a set time, and always with a reason. Ending one sets `validUntil` rather than deleting it.
- **Bulk assignment** (exams chosen by IDs, by category or by tags, × several targets) creates plain rows once; it isn't a live rule. It's all or nothing: one pair outside the caller's scope, or one duplicate, means nothing is created.
- The **preview** computes each affected student's window with the same function the resolver uses, so it always matches what the student will see.

`resolveAvailability` (pure, in `modules/assignments/availability.ts`) decides, in order:
1. No assignment reaches the student → `NOT_ASSIGNED` (an override alone doesn't assign).
2. Draft or archived exam → `CLOSED`; external exam (CTF) → `EXTERNAL`.
3. An attempt in progress → `OPEN` (resumable). All attempts used → `SUBMITTED`; overrides never reopen it.
4. Active overrides: the student's newest override wins; otherwise a group CLOSE beats a group OPEN.
5. Schedules: a personal assignment **replaces** the group ones; otherwise group windows add up.
6. Result: `OPEN` (inside a window), `SCHEDULED` (earliest upcoming window), `MISSED` (all windows over, never attempted), or `CLOSED`.

It also returns the student's **progress**: `NOT_STARTED`, `IN_PROGRESS`, `ANSWERED` (submitted, awaiting review), `UNDER_REVIEW` or `REVIEWED`. Staff see the deciding `source` and a readable `reason` ("why is this open?").

## Exam attempts (data model; logic comes with the exam-session plan)

- Attempts are created by the server, with a server-side `deadlineAt`; the client timer is display only.
- The database allows **at most one `IN_PROGRESS` attempt per student per exam** (a partial unique index), so two tabs or devices can't both start.
- `(examId, userId, attemptNo)` is unique, and `Exam.maxAttempts` defaults to 1.
- `Option.isCorrect` is never sent to students; grading happens on the server.
- After submission, staff with `ATTEMPT_REVIEW` move an attempt through `reviewStatus` (PENDING → UNDER_REVIEW → REVIEWED).

## Audit log

Every staff change is audited **in the same transaction** as the change. If either fails, neither is saved. Logins and logouts are audited on a best-effort basis.

`AuditLog` is append-only: a database trigger rejects every UPDATE or DELETE. The single exception is the foreign key setting `actorId` to null when a user is deleted.

## Testing

| Layer | What |
|---|---|
| Unit | Pure rules: `authorize`, the scope filters, `resolveAvailability` (more than 40 table cases, including Egypt's daylight-saving changes), time, slugs, CSV |
| Property-based | fast-check invariants. For access: monotonic grants, no cross-grant combining, expired grants grant nothing. For scheduling: OPEN exactly inside a window, CLOSE overrides never open, SUBMITTED is stable. Plus list filters that agree with `authorize` |
| Integration | Each module against a real Postgres (`xpand_test`; the tests refuse any other database) |
| RBAC matrix | `src/rbac.matrix.int.test.ts`: every non-public route × 8 actors, each cell against a freshly seeded world (`test/rbac-world.ts`). A route without rows fails the build. |
| Coverage gates | 80% overall; 95% for `rbac/`, `catalog/` and the availability resolver |

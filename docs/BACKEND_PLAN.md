# Backend plan: foundations, RBAC, exam catalog and assignment

Scope of this plan: **backend only**.
1. Engineering foundations: infrastructure, code structure, readability, testing.
2. **Access control (RBAC)**, complete and proven by tests.
3. **Exam catalog with categories and tags.**
4. **Exam assignment and scheduling.**

Out of scope ([NEXT_PLAN.md](NEXT_PLAN.md)): the exam session itself (attempts, anti-cheat, proctoring), results and grading, frontend work.

The current state is M0 (see [ARCHITECTURE.md](ARCHITECTURE.md)): login, sessions, the `authorize()` core, the full data model, Docker. The phases are named **B0 to B4**.

> **Status (2026-10-02): B0–B4 are implemented.** [ARCHITECTURE.md](ARCHITECTURE.md) describes the result.
>
> **Decisions confirmed:** D1, D5, D7 and D8 as recommended; D10 = GitHub Actions (`.github/workflows/ci.yml`).
>
> **Added after the plan was written:** a per-student **progress** status (NOT_STARTED → IN_PROGRESS → ANSWERED → UNDER_REVIEW → REVIEWED), with a new `ATTEMPT_REVIEW` permission and `Attempt.reviewStatus`.
>
> **Where the build differs from §4–§5:**
> - **Endpoints:** assignment routes live at `/api/assignments` (list with `?examId=`), and overrides at `/api/overrides`.
> - **No archive endpoint:** exams are archived with `PATCH /api/catalog/exams/:id { status: "ARCHIVED" }`.
> - **Overrides are ended, not deleted:** `POST /api/overrides/:id/end`.
> - **New view:** `GET /api/assignments/availability?examId=` gives staff the "why is this open?" view.
> - **Categories and tags moved earlier:** their schema landed in B1, because category-scoped grants need it.
> - **TypeScript is pinned to 6.0:** typescript-eslint doesn't support TypeScript 7 yet.

---

## 1. Decisions to confirm

Each has a recommended default; the plan below assumes it.

| # | Question | Recommended default | Why |
|---|---|---|---|
| D1 | How many categories per exam? | **Exactly one** (required) | A clear home for each exam ("Networking", "Cloud", "CTF"). Use tags for everything that cuts across categories. |
| D2 | Can categories be nested? | **No, a flat list** | 5–10 categories don't need a tree, and a tree complicates scoping and filters. |
| D3 | What can be tagged? | **Exams now; questions later** (question pools by tag, when the question bank is built) | Matches the current goal; the same tag table is reused later. |
| D4 | Who creates tags? | **The super admin manages the list; instructors with `EXAM_EDIT` attach existing tags** | Free-form tags multiply ("cloud", "Cloud", "cloud-basics"). |
| D5 | Can an instructor's grant cover a whole category? | **Yes, and it covers future exams too.** A grant's exam scope = all exams, OR listed exams, OR exams in listed categories. | "Instructor X manages everything in Cloud" without re-editing grants every time an exam is added. |
| D6 | When is a student in an instructor's group scope? | **When they belong to at least one group the grant covers** | Students can be in several groups (for example a cohort plus a make-up group). |
| D7 | A student has both a personal assignment and group assignments for the same exam: which applies? | **The personal assignment replaces the group ones. Among several group assignments, the exam is open if any window is open; the earliest upcoming opening is shown.** | The personal assignment is the deliberate exception (for example a late joiner); groups add together. |
| D8 | "Assign every exam in category X to group G": a live rule or a one-time action? | **One-time:** it creates one assignment row per exam, listed and audited | It's predictable; a new exam in the category isn't assigned to anyone by surprise. |
| D9 | Time zone handling | **Store UTC; calculate Africa/Cairo wall times with `@date-fns/tz`** (or Temporal when Node ships it without a flag) | Egypt has daylight saving time; hand-written offset arithmetic will be wrong twice a year. |
| D10 | CI platform | **GitHub Actions** (if the repository is on GitHub) | Postgres is available there as a service container for the integration tests. |

---

## 2. Target code structure

### 2.1 Group the code by feature, not by technical layer

```
server/src/
  app.ts                  createApp(deps): builds Express from its dependencies (no module-level singletons)
  index.ts                reads the config, creates the dependencies, starts the server
  core/
    config.ts             zod-validated env (unchanged)
    db.ts                 createPrisma(url)
    errors.ts             AppError + error codes, plus the single error handler
    validate.ts           validate({ body, params, query }) middleware → typed req.valid
    route.ts              defineRoute(): every route declares its access policy (§2.3)
    logger.ts             pino with request id; secrets redacted
    audit.ts              audit(tx, entry): written inside the same transaction as the change
    time.ts               Cairo ↔ UTC helpers (D9), the only file allowed to do time-zone math
    pagination.ts         cursor pagination helpers shared by every list endpoint
  modules/
    auth/                 (exists) routes, session, password
    rbac/                 authorize, scope filters, grant CRUD, /me/permissions
    users/                minimal admin CRUD (needed to assign exams)
    groups/               groups + members + join dates
    catalog/              categories, tags, exams
    assignments/          assignments, overrides, availability resolver, student exam list
  test/
    factories.ts          makeUser / makeGroup / makeExam / makeGrant …
    http.ts               loginAs(user) → a supertest agent with the cookie
    db.ts                 resetDb() against the test database only
```

Each module has `routes.ts` (HTTP only), `service.ts` (business rules), `schemas.ts` (zod) and tests next to the code. Prisma is used directly from services; there's no extra repository layer, because Prisma already is one.

### 2.2 Conventions (enforced in review and by lint)

- **Routes are thin:** validate the input → check access → call one service function → send the result. No business logic, and no Prisma calls, in `routes.ts`.
- **Services take a context:** `fn(ctx, input)` with `ctx = { db, principal, now, req? }`. Tests can pass a fixed `now` and a transaction, so there's no mocking of globals.
- **Errors are thrown, not hand-written:** `throw new AppError("EXAM_NOT_FOUND", 404)`. One handler formats every error response.
  - Error codes live in one list, which feeds the frontend guide's error table.
  - Not found and forbidden: a resource **outside** the caller's scope returns **404**, not 403, so its existence isn't revealed. 403 is kept for "you can see it but can't do this".
- **Every staff change is one transaction:** the change and its audit entry together. If the audit write fails, the change is rolled back. Login and logout keep best-effort auditing.
- **No module-level side effects:**
  - Config parsing and the Prisma client creation move out of import time into `createApp(deps)`.
  - This removes the `process.env.DATABASE_URL ??=` workaround in today's session test.
- **Pure functions for the rules:** `authorize`, `scopeFilter` and `resolveAvailability` take plain data and return plain data. They carry most of the test weight and need no database.
- **Tooling:**
  - ESLint (typescript-eslint, strict) + Prettier, in CI.
  - Ban `console.*` (use the logger), ban default exports, ban any non-null assertion `!` outside tests.
- **Naming and size:**
  - One concept per file; aim for under 250 lines per file.
  - Use domain names (`resolveAvailability`, `assignExamToGroup`), not generic ones (`handle`, `process`, `utils`).

### 2.3 Every route must declare an access policy (a guard against forgotten checks)

```ts
defineRoute(router, {
  method: "post",
  path: "/exams/:examId/assignments",
  input: { params: examIdParams, body: createAssignmentBody },
  access: { permission: "EXAM_ASSIGN", scope: (req) => assignmentScope(req) }, // or access: "public" | "authenticated" | "student"
  handler: (ctx, input) => assignments.create(ctx, input),
});
```

`defineRoute` registers the route **and** records its policy. A test lists every registered route and **fails if a route has no policy**, so an unprotected endpoint can't be merged by accident.

---

## 3. RBAC: final design and test strategy

### 3.1 Scope rules (extends today's `authorize`)

The scope passed to `authorize` becomes `{ examId?, categoryId?, groupIds? }`.

- **A grant covers an exam** when:
  - it covers all exams, OR
  - it lists the exam, OR
  - it lists the exam's category (D5).
- **A grant covers a group target** when it covers all groups, or lists that group.
- **A grant covers a student** when it covers all groups, or lists **at least one** group the student belongs to (D6). A student in no group is covered only by "all groups" grants.
- **One grant must cover everything.** Unchanged from M0: a single unexpired grant must hold the permission and cover the exam and the group. Grants are never combined.

### 3.2 Two reusable building blocks

| Block | Used for | Example |
|---|---|---|
| `authorize(principal, permission, scope)` | Checking one action | "Can this instructor assign exam E to group G?" |
| `scopeFilter(principal, permission)` → Prisma `where` | Filtering a list query | "List the exams I can view results for." It builds an OR of the grants, each grant's exam and group conditions combined with AND, so lists never leak cross-grant combinations. |

**Scope resolvers** turn a request into a scope in one place each:
- `examScope(examId)` loads the exam's category.
- `studentScope(userId)` loads the student's groups.
- `assignmentScope(...)` combines the two.

Routes never assemble scopes by hand.

### 3.3 Grant management API (super admin only)

- `GET /rbac/grants?userId=`, `POST /rbac/grants`, `PATCH /rbac/grants/:id`, `DELETE /rbac/grants/:id`
- Validation:
  - Only instructors can receive grants.
  - Listed exams, categories and groups must exist.
  - At least one permission.
  - `expiresAt` must be in the future.
- `GET /me/permissions`: the caller's role and active grants, for the UI (frontend guide §4.1).
- Effect is immediate: grants are loaded on every request (§3.2 of the architecture). This is a measured choice; cache only if profiling shows a need.

### 3.4 How RBAC will be proven

| Layer | What | Tool |
|---|---|---|
| Unit tests | `authorize`: every rule in §3.1, expiry exactly at the boundary, category scope, multi-group students | vitest (exists, extended) |
| Property-based tests | Invariants over thousands of random principals and grants. A super admin is always allowed and a student never is. An expired grant never grants anything. **Adding a grant never removes access. Removing a grant never adds access.** No combination across grants. `scopeFilter` agrees with `authorize` on every generated row. | fast-check |
| Policy coverage | Every route has a declared policy (§2.3) | route listing test |
| **Endpoint matrix** | One data table: endpoint × actor × expected status. A test generator runs every cell against the real API and database. | vitest + supertest, generated from `rbac.matrix.ts` |
| Isolation | For each list endpoint, seed data both inside and outside the scope and check that the out-of-scope IDs never appear in responses, counts or pagination totals | integration |
| Audit | Every grant change writes an audit entry, in the same transaction | integration |

**Fixed actors for the matrix** (built by factories):

| Actor | Setup |
|---|---|
| `superAdmin` | none |
| `student` | member of group A |
| `instNone` | instructor, no grants |
| `instExamA` | `RESULTS_VIEW, EXAM_ASSIGN` on exam E1 × group A |
| `instCategory` | `EXAM_EDIT, EXAM_ASSIGN, EXAM_SCHEDULE` on category Cloud × all groups |
| `instSplit` | two grants: E1 × A and E2 × B (the combination trap) |
| `instExpired` | everything, expired |
| `anonymous` | not logged in |

Each new endpoint adds one row per actor. A missing row fails the test; a matrix that doesn't cover an endpoint is a test failure, not a gap.

---

## 4. Exam catalog: categories and tags

### 4.1 Schema changes (one migration)

```prisma
model Category {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique
  slug      String   @unique          // "networking", stable for URLs and filters
  position  Int      @default(0)      // display order
  archived  Boolean  @default(false)  // hidden from pickers, kept for history
  exams     Exam[]
  grants    GrantCategory[]
}

model Tag {
  id        String    @id @default(uuid()) @db.Uuid
  name      String    @unique
  slug      String    @unique
  exams     ExamTag[]
}

model ExamTag      { examId, tagId   — @@id([examId, tagId]) }
model GrantCategory { grantId, categoryId — @@id([grantId, categoryId]) }

// Exam gains:  categoryId String @db.Uuid  (required, D1) + tags ExamTag[]
```

- Slugs are generated from names and are unique, and names are compared without regard to case: a `citext` column or a unique index on `lower(name)`, so "Cloud" and "cloud" can't both exist.
- A category can't be deleted while exams use it; archive it instead.
- Deleting a tag removes it from exams (the `ExamTag` rows cascade). This is audited.

### 4.2 API

| Endpoint | Access |
|---|---|
| `GET /catalog/categories`, `GET /catalog/tags` | Any staff user |
| `POST/PATCH/DELETE /catalog/categories…`, `…/tags…` | Super admin |
| `GET /catalog/exams?category=&tag=&status=&q=&cursor=` | Staff; the list is limited by `scopeFilter` to exams the caller can see with any permission |
| `POST /catalog/exams` | Super admin, or `EXAM_EDIT` on the target category |
| `GET/PATCH /catalog/exams/:id` | `EXAM_EDIT` within scope (read access needs any permission within scope) |
| `PUT /catalog/exams/:id/tags { tagIds }` | `EXAM_EDIT` within scope; replaces the whole tag set |
| `POST /catalog/exams/:id/archive` | `EXAM_EDIT` within scope |

**Filter semantics:**
- Several tags means the exam must have **all** of them (AND).
- `category` and `tag` combine with AND.
- `q` searches the title and code.
- All filters are applied **inside** the scope filter, never instead of it.

**Moving an exam to another category** changes who can reach it through category grants. The API requires `EXAM_EDIT` on **both** the old and the new category, and it's audited.

### 4.3 Tests

- Unit: slug generation, case-insensitive uniqueness, filter → `where` building.
- Integration:
  - CRUD, and archive rules.
  - Moving an exam between categories (permission on both sides).
  - Tag replace is idempotent.
  - Filters with pagination return correct totals inside the scope.
  - `instCategory` automatically gains a **newly created** Cloud exam (D5).

---

## 5. Exam assignment and scheduling

### 5.1 The availability resolver (pure function, the core of this phase)

```ts
resolveAvailability({
  exam,                  // settings, archived?
  student,               // joinDate, memberships [{ groupId, joinDate, group.intakeStartDate }]
  assignments,           // for this exam, targeting the student or their groups
  overrides,             // for this exam, targeting the student or their groups
  attempts,              // the student's attempts on this exam
  now,
}) → { status: "NOT_ASSIGNED" | "SCHEDULED" | "OPEN" | "CLOSED" | "MISSED" | "SUBMITTED" | "EXTERNAL",
       opensAt?, closesAt?, source: "user-assignment" | "group-assignment:<id>" | "user-override" | "group-override", reason }
```

Order of evaluation:
1. Not assigned (no assignment for the student or any of their groups) → `NOT_ASSIGNED`.
2. Archived or external exam → `CLOSED` or `EXTERNAL`.
3. Attempts used up → `SUBMITTED`. An override never reopens a submitted exam; that needs a void or reopen, which belongs to the next plan.
4. An active user override, then an active group override → `OPEN` or `CLOSED`. If group overrides conflict, CLOSE wins.
5. Assignment windows (D7): the user assignment replaces the group ones; otherwise the exam is open if any group window is open.
   - **FIXED:** `opensAt` to `closesAt`.
   - **RELATIVE:** anchor (member join date → group intake date; or the user's join date for a personal assignment) + `offsetDays`, at `openTime` Cairo time (D9), lasting `windowMinutes`.
   - **MANUAL:** closed unless overridden.
6. The window has passed with no attempt → `MISSED`; the window hasn't started → `SCHEDULED`; otherwise → `OPEN`.

`source` and `reason` are returned so staff and the tester can see *why* (frontend guide §4.4, test plan §5.3).

### 5.2 API

| Endpoint | Access |
|---|---|
| `GET /exams/:examId/assignments` | `EXAM_ASSIGN` or `EXAM_SCHEDULE` on the exam; the list contains only targets in scope |
| `POST /exams/:examId/assignments` | `EXAM_ASSIGN`, covering the exam **and** the target (group, or the student via their groups) |
| `PATCH /assignments/:id` (schedule fields) | `EXAM_SCHEDULE`, same scope rule |
| `DELETE /assignments/:id` | `EXAM_ASSIGN`, same scope rule |
| `POST /assignments/bulk { examIds \| categoryId \| tagIds, targets[], schedule }` | Each exam × target pair is checked. **All or nothing:** if any pair is out of scope, nothing is created and the response lists the refused pairs (D8). |
| `POST /assignments/preview` (same body, nothing saved) | Same as create; returns the resolved opening and closing time per affected student |
| `POST/DELETE /exams/:examId/overrides…` | `EXAM_SCHEDULE`, same scope rule; a reason is required |
| `GET /student/exams` | Student; only their own assigned exams with the resolved status |

**Duplicates:** a second assignment of the same exam to the same target is refused (409) instead of silently stacking. This is enforced by a unique index on `(examId, userId)` and `(examId, groupId)`.

### 5.3 Tests

- **Resolver, table-driven:** at least 40 cases.
  - Every status, and every precedence step in §5.1.
  - A late joiner; a student in two groups with different windows.
  - Window edges (one second before and after opening and closing).
  - **A RELATIVE schedule across Egypt's daylight-saving change**, both directions.
- **Property-based:**
  - Without overrides, an exam is never `OPEN` outside every window.
  - Adding a CLOSE override never makes an exam open.
  - `SUBMITTED` is stable under any override.
- **Integration:**
  - Each endpoint through the RBAC matrix.
  - Bulk all-or-nothing, and preview equals the result after saving.
  - Duplicate assignment → 409.
  - `/student/exams` never lists unassigned exams.
  - Everything is audited in the same transaction.

---

## 6. Infrastructure and testing setup

| Item | Change |
|---|---|
| **Test database** | A separate `xpand_test` database (a second database in the dev compose file). Integration tests refuse to run unless the database name ends in `_test`, so they can never wipe dev or production data (today they truncate the dev database). |
| **Speed and flakiness** | Use a lower bcrypt cost in the test environment, set through config (12 stays in production). The cost currently makes the auth suite take about 40 s, and is the likely cause of the one unexplained failure in 12 runs. Re-run the suite 20 times in CI before closing the flake. |
| **Factories and helpers** | `makeUser({ role, groups })`, `makeGrant(...)`, `makeExam({ category, tags })`, `loginAs(user)`. Tests read like the scenarios in the test plan. |
| **CI pipeline** | Lint → typecheck → unit → integration (Postgres service) → coverage gate → Docker build. Runs on every pull request; `main` is protected. |
| **Coverage gates** | `rbac/`, `assignments/resolver`, `catalog/`: **95% of lines and branches**. Everything else: 80%. |
| **Logging** | pino JSON logs with a request ID per request, the user ID when known, and passwords, tokens and cookies redacted. The container's stdout goes to CloudWatch through Docker's `awslogs` driver on EC2. |
| **Health** | `/api/health/live` (the process is up) and `/api/health/ready` (the database is reachable); the Docker health check uses `ready`. |
| **TLS** | Add a Caddy service to `docker-compose.yml` (automatic HTTPS); only ports 80 and 443 open in the EC2 security group; Postgres never published. |
| **Secrets** | `.env` on the host, readable only by its owner (`chmod 600`), or AWS SSM Parameter Store; never baked into the image. |
| **Backups** | Nightly `pg_dump` to S3 with 30-day retention, plus a **restore test** each release (an untested backup isn't a backup). |
| **Image size** | Down from 837 MB: install only the server's production dependencies in the runtime stage, not the web packages, and copy only the Prisma engine actually needed. Target under 350 MB. |
| **Dependencies** | Exact version pins; Dependabot or Renovate weekly; Prisma stays on stable releases (not the 8.x pre-releases). |
| **Migrations** | Each migration is reviewed as SQL. Destructive changes happen in two steps (stop using the column, deploy, then drop it in a later release). |

---

## 7. Phases

| Phase | Content | Exit criteria | Size* |
|---|---|---|---|
| **B0: Engineering baseline** | §2 structure refactor of the existing auth code (no behaviour change); `errors.ts`, `validate.ts`, `defineRoute`, logger, `createApp(deps)`; test database, factories, lower bcrypt cost in tests; ESLint + Prettier; CI | All existing tests are green in CI; the policy-coverage test exists; the flake is fixed or explained | 4–5 days |
| **B1: RBAC complete** | Category scope (D5), multi-group students (D6), `scopeFilter`, scope resolvers, grant CRUD, `/me/permissions`, minimal users and groups admin endpoints; property tests; **RBAC endpoint matrix** | The matrix covers every endpoint; property tests pass; 95% coverage on `rbac/` | 5–6 days |
| **B2: Catalog** | Category and tag schema + migration; exam CRUD with filters and pagination; tag management; category move rules | §4.3 green; matrix rows added for every catalog endpoint | 4 days |
| **B3: Assignment and scheduling** | `time.ts` (D9), `resolveAvailability`, assignment and override CRUD, bulk + preview, unique constraints, `/student/exams` | §5.3 green, including the daylight-saving cases; matrix rows for every endpoint | 6–7 days |
| **B4: Infrastructure hardening** | Caddy TLS, CloudWatch logs, health endpoints, backups + a restore test, image slimming, deploy runbook | A staging deploy from a clean EC2 host by following the runbook alone; the restore test passes | 3 days |

\* Rough working days for one backend developer familiar with the stack. B0 must come first. B4 can run in parallel with B2/B3 if someone else handles the infrastructure.

**After B3**, the frontend can build the admin, catalog and assignment screens against real endpoints, and the tester can run test plan §5.1–5.3. Mark the matching **DRAFT** endpoints in [FRONTEND_GUIDE.md](FRONTEND_GUIDE.md) as final as each phase lands.

---

## 8. Definition of done (every backend PR)

- Lint, typecheck, unit and integration tests pass in CI; coverage gates are met.
- Every new route uses `defineRoute` with an access policy, and has RBAC matrix rows for **all** actors.
- Every new list endpoint has an isolation test (out-of-scope data never appears).
- Business rules live in pure functions or services with unit tests; routes stay thin.
- Every staff change is audited in the same transaction.
- New error codes are added to the single error list and to the frontend guide's error table.
- Migrations are reviewed as SQL; new constraints are covered by a test.
- ARCHITECTURE.md is updated if a rule changed.

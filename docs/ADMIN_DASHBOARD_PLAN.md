# Plan: the admin dashboard (frontend + backend + integration tests)

**Goal:** a super admin manages the academy from the browser, without the API or scripts. The dashboard covers:
- users and groups;
- instructors and their access;
- the exam catalog with questions;
- assigning and scheduling exams;
- opening or closing exams now;
- the audit log.

Every flow is proven by integration tests that drive the real browser against the real server and database.

**Starting point (verified 2026-10-12):**
- The admin can log in through the interface, change the temporary password, reload, and log out. These are the only screens today.
- The backend already has 47 endpoints for everything above except exam questions, the audit viewer, dashboard numbers and CSV import ([API.md](API.md)).

This plan carries out frontend phase **F1** and part of **F2** from [NEXT_PLAN.md](NEXT_PLAN.md). It pulls forward the backend pieces the dashboard needs:
- **B5:** exam content.
- From **B9:** the audit viewer (super admin only).
- From **B12:** CSV import and admin stats.

Phases are named **A0 to A7**.

**Out of scope:**
- the student dashboard and the exam session (F2 for students, F3);
- results, proctoring and attendance (later phases of NEXT_PLAN).

**Instructors:** the screens are built for the super admin first, but every one is permission-aware. An instructor sees the same exam, assignment and override screens, limited to their grants, with no extra frontend work.

---

> **Status (2026-10-12): A0–A7 are implemented** on the `feat/admin-dashboard` branch, one commit per phase.
>
> - **Decisions:** all as recommended. React Router is version 8 (the current major; the plan said 7).
> - **Backend added:** BE-1 to BE-6 as planned, plus B5 (exam content) in full: 63 API routes in total.
> - **Tests:** 830 server tests (coverage gates met), 36 web unit and component tests, and 61 browser tests (including axe on every page and phone width) that run in CI.
> - **Where the build differs:**
>   - Questions are reordered with "move up / move down" buttons rather than drag and drop: the same result, and it works with the keyboard and screen readers.
>   - The audit log is super-admin only. The scoped view for instructors with `AUDIT_VIEW` comes in B9, as planned in NEXT_PLAN E18.
>   - The exit test (§7) is automated as `e2e/exit.spec.ts`. Run it once by hand on staging before the first real intake.
>   - Fixed along the way: primary colours darkened for WCAG AA contrast; page grids no longer overflow on phones; number fields show "At least 1" instead of "Enter a number" for values out of range.

## 1. Decisions to confirm

Each has a recommended default; the plan assumes it.

| # | Question | Recommended default | Why |
|---|---|---|---|
| A-D1 | Routing | **React Router 7** (`createBrowserRouter`), one route per screen, so deep links and reloads work | The standard choice; the server already serves `index.html` for unknown paths in production |
| A-D2 | Server data in the browser | **TanStack Query 5**: caching, loading and error states, refetch after a change | Removes hand-written loading and state code in every screen |
| A-D3 | Forms | **React Hook Form + Zod 4** (the server already uses Zod 4) | The same validation messages in the browser and on the server; the server still decides |
| A-D4 | Keeping frontend and backend types in sync | **Shared wire types:** the server exports its response types from one file (`server/src/contracts.ts`), converted to JSON shapes (dates and decimals become strings). The web imports them **type-only**, so no server code reaches the browser. If the half-day spike fails, the fallback is types written by hand in `web/src/api/types.ts`, guarded by the integration tests. | A renamed field then breaks the frontend build, not production |
| A-D5 | UI components | **A small in-house kit on Tailwind:** table, form fields, buttons, badge, empty state, toast. **Radix UI** only for the accessible parts that are hard to get right: dialog, dropdown menu, popover. | No large design library to fight; keyboard and screen-reader support where it matters |
| A-D6 | Dates and times | All times are **shown and entered in Africa/Cairo** (`@date-fns/tz`, the same library as the server) and sent as UTC. Every time shown carries its zone ("10:00 Cairo"). | Admins outside Egypt, and daylight saving, can't shift a schedule by an hour |
| A-D7 | Long lists | **"Load more"**, using the API's `nextCursor`, plus server-side search and filters | The API uses cursor pagination, not page numbers |
| A-D8 | Integration tests | **Playwright Test**, against the **production-like build**: the server serves the built web app on one origin, with its own database `xpand_e2e`. Runs locally and as a new CI job. | It tests what will actually ship: cookies, CSRF rule, same-origin, SPA fallback |
| A-D9 | Component tests | **Vitest + Testing Library + MSW** (mocked API), only for the complex widgets: the grant editor, the schedule form, the date/time field | Fast feedback on tricky logic; everything else is covered by the integration tests |
| A-D10 | Accessibility | Each page is checked with **axe** inside the integration tests; no serious or critical violations allowed | Cheap to add now, expensive to retrofit |

---

## 2. Backend additions

All follow the existing rules:
- `ApiRouter` with an access policy;
- Zod input;
- service with unit tests;
- audit in the same transaction;
- RBAC matrix rows;
- an [API.md](API.md) update in the same pull request.

| # | Endpoint | Access | Why the dashboard needs it | Phase |
|---|---|---|---|---|
| BE-1 | `GET /api/admin/stats` → `{ users: { students, instructors, admins, inactive }, groups, exams: { draft, published, archived }, assignments, activeOverrides, activeSessions, lockedAccounts }` | Super admin | The dashboard home page (a subset of OPS-4) | A2 |
| BE-2 | `GET /api/audit?actorId=&action=&entityType=&entityId=&from=&to=&cursor=` → `{ items: [{ id, at, actor: { id, username, fullName } \| null, action, entityType, entityId, detail, ip }], nextCursor }` | Super admin (instructors with `AUDIT_VIEW` follow in B9, per E18) | The audit log screen | A2 |
| BE-3 | `POST /api/users/import { rows: [{ username, fullName, email?, mobile?, role?, joinDate?, groupNames? }], dryRun }` → `{ created: [{ username, temporaryPassword }], errors: [{ row, field, message }] }` | Super admin | CSV import screen (USR-5). The browser parses the CSV; the server validates. **All or nothing**, max 500 rows, `dryRun` shows the errors first. It reuses the `import-users` script's logic, so the script and the screen behave the same. | A3 |
| BE-4 | Exam content: question and option CRUD, reorder, JSON import, materials CRUD, duplicate exam, the publish check, the edit lock | `EXAM_EDIT` | The question editor. This is **B5 from NEXT_PLAN.md, unchanged** (see its §2 for endpoints and rules). | A6 |
| BE-5 | `GET /api/users/lookup?q=&role=&limit=20` → `[{ id, username, fullName, role }]` | Super admin; instructors get students in their scope | Fast pickers ("choose a user") without loading full user records | A3 |
| BE-6 | Wire types: `server/src/contracts.ts` exports the response types of every endpoint the dashboard uses, plus `Wire<T>` (Date → string, Decimal → string) | — | A-D4 | A0 |

**Checks while building the screens:** each screen may reveal a missing filter or field (for example "list groups with member counts"). Add it the same way, in the same pull request as the screen, with its matrix rows and an API.md update. Never work around a gap in the browser.

---

## 3. Frontend structure

```
web/src/
  main.tsx              router + providers
  app/                  layout (sidebar, header), route table, guards, error and 404 pages
  lib/
    api/                client (fetch wrapper, ApiError), one file per area: users.ts, groups.ts, …
    query.ts            TanStack Query client, shared query keys
    time.ts             Cairo ↔ UTC helpers (A-D6)
    permissions.ts      can(user, grants, permission, scope?): menu and button visibility only
  components/           the kit: Button, Field, Table, Dialog, ConfirmDialog (with reason), Toast,
                        EmptyState, Badge, Picker (search + select), DateTimeField, PageHeader
  features/
    dashboard/ users/ groups/ grants/ catalog/ exams/ assignments/ overrides/ audit/
      <Screen>.tsx      one page per route
      components/       widgets used only by this feature
  test/                 MSW handlers, render helpers
e2e/                    Playwright specs, fixtures, global setup (repository root)
```

**Rules** (from [FRONTEND_GUIDE.md §3](FRONTEND_GUIDE.md), plus):
- Screens never call `fetch`; they use the `lib/api` functions through TanStack Query hooks.
- **The browser never decides security.** Hidden buttons are a convenience; the server returns 403 or 404 and the screen shows it properly.
- Every API error code has a readable message in one place (`lib/api/errors.ts`). `VALIDATION_FAILED` details are mapped onto the form fields.
- Destructive or sensitive actions use `ConfirmDialog`; when the API takes a `reason`, the dialog requires it. Examples: deactivate a user, delete a grant, end an override, archive an exam.
- **Secrets shown once** (temporary passwords from create, reset and import) appear in a dialog with "Copy". They are never stored in query caches, local storage or logs. Closing the dialog loses them for good.
- Every list has loading, empty, error and "load more" states.
- After a change, the related queries are refetched. No hand-merging of server data.
- If the session expires (any 401), the app returns to Login with "Your session expired" and comes back to the same page after logging in.

---

## 4. Screens, by phase

### A0: Foundations (frontend + types)

- **Libraries:** router, TanStack Query, React Hook Form, Zod, Radix (dialog, dropdown, popover), `@date-fns/tz`. Exact versions pinned, as everywhere else.
- **Wire types:** BE-6 and the spike for A-D4.
- **App shell:**
  - sidebar by role and permission;
  - header with name, role and Logout;
  - 404 page and "no access" page;
  - session-expired handling.
- **Component kit** (§3), plus favicon and page titles.
- **Test setup:**
  - Vitest + Testing Library + MSW in `web`;
  - Playwright in `e2e/` with the global setup of §5;
  - the first spec: login → forced password change → home → reload → logout. This automates what was checked by hand on 2026-10-12.
- **Lint and format** cover `web/` and `e2e/`; CI gets the `e2e` job (§5.4).

*Done when:* the first integration spec passes locally and in CI, and the existing login and change-password pages are moved onto the router and kit with no change in behaviour.

### A1: Users and groups

| Screen | Route | Content |
|---|---|---|
| Users list | `/admin/users` | Search, filter by role, group and active; columns: name, username, role, groups, join date, status |
| User detail / edit | `/admin/users/:id` | Edit name, email, mobile, role, join date, active. **Reset password** shows the temporary password once. Groups the user belongs to. |
| New user | `/admin/users/new` | Form → the created user plus the temporary password, shown once |
| Groups list | `/admin/groups` | Name, intake date, member count |
| Group detail | `/admin/groups/:id` | Edit name and intake date; members table with **per-member join date** (late joiners); add members (picker), remove members |

Guard rails shown in the screens, enforced by the server:
- you can't change your own role or deactivate yourself;
- a role change or deactivation signs that user out everywhere (the confirmation dialog says so).

### A2: Dashboard home and audit log (BE-1, BE-2)

- `/admin`: number cards from BE-1. Each card links to the matching filtered list, for example "3 locked accounts" opens the users list filtered to locked accounts.
- `/admin/audit`: filter by user, action, type and date range. Each row shows who, what and when, and the entity with a link where a screen exists. Expanding a row shows the `detail` JSON in readable form. Read-only.

### A3: Instructors and grants, CSV import (BE-3, BE-5)

| Screen | Route | Content |
|---|---|---|
| Instructors | `/admin/instructors` | Instructors with their active grant count and the earliest expiry |
| Grant editor | `/admin/instructors/:id` | List of grants, each **rendered as a sentence** (FRONTEND_GUIDE §4.4), e.g. "Can view results and schedule exams in *Cloud* for *Intake July 2026* until 31 Dec 2026". Create, edit, delete. |
| CSV import | `/admin/users/import` | Upload → preview table with row errors (dry run) → import → credentials shown once, with "Download as CSV" generated in the browser |

**The grant editor:**
- permission checkboxes with the labels from FRONTEND_GUIDE §4.6;
- exam scope: All, or chosen exams, or chosen categories;
- group scope: All, or chosen groups;
- optional expiry.

It warns that grants never combine ("one grant must cover the exam and the group"), shows an example of what the grant allows before saving, and has component tests for every scope combination.

### A4: Catalog: categories, tags, exams (settings)

| Screen | Route | Content |
|---|---|---|
| Categories and tags | `/admin/catalog` | Two lists: create, rename, archive or delete (delete refused while in use; the screen offers archive) |
| Exams list | `/exams` | Filter by category, tags (all of), status, text; only exams in the caller's scope |
| Exam settings | `/exams/:id` and `/exams/new` | Title, code, category, tags, duration, pass mark, weight, attempts, shuffle, back navigation, strike limit, fullscreen, external. Status: Draft → Published → Archived. Moving to another category warns about access changes. |

### A5: Assign, schedule, open and close (the "why is this open?" view)

| Screen | Route | Content |
|---|---|---|
| Exam assignments | `/exams/:id/assignments` | Assignments of this exam (to users and to groups): schedule mode and window, edit the schedule, remove |
| Assign | dialog from the exam, or `/assignments/new` for bulk | Targets (users and/or groups, pickers limited to scope). Mode: **Fixed** (open/close date-time), **Relative to join date** (day offset + time + window length), **Manual**. **Preview table** (`POST /assignments/preview`): each affected student with their resolved opening and closing time in Cairo time, *before* saving. Bulk: exams by list, category or tags. All or nothing: refused pairs are listed. |
| Overrides | `/exams/:id/overrides` | Open or close now for a user or group, optional end time, **required reason**. Active and past overrides; "End now". The precedence is explained on the page (user > group > schedule). |
| Availability | `/exams/:id/availability` | For each student: status, progress, window, and the **reason** ("Group B window 10:00–12:00 Cairo", "Closed by override: …"). Filter by group or status. |

### A6: Exam content (BE-4, i.e. B5)

| Screen | Route | Content |
|---|---|---|
| Question editor | `/exams/:id/questions` | List with drag-to-reorder (also keyboard: move up/down). Editor per type: single choice, multiple choice, true/false. Option list with "correct" toggles, points, image URL, live preview as the student will see it (without the answer). |
| Import questions | dialog | Upload JSON (format documented on the page) → dry run with errors → import |
| Materials | `/exams/:id/materials` | Title + URL list, reorder |
| Publish | on the exam page | The publish check's problem list, each linking to the question to fix. Once an attempt exists, the editor shows **"Locked: text fixes only"** and offers **Duplicate exam**. |

### A7: Integration hardening and release

- **Full flow specs** (§5.3) and the RBAC spec for instructors.
- **axe** checks on every page, a pass at mobile width (the admin dashboard is mainly desktop, but nothing may be unusable on a tablet), and keyboard-only runs through the main forms.
- **Docs:**
  - FRONTEND_GUIDE screens marked done;
  - API.md updated;
  - TEST_PLAN §5.1–5.3 checklists marked "automated" where an integration spec covers them.
- **Release:** deploy to staging and run the manual exit test (§7).

---

## 5. Integration testing (frontend ↔ backend)

### 5.1 What runs

The real app, as it ships:
- The server is started from the built code, and serves the **built web app** on one origin (`WEB_DIST`).
- It runs against its own Postgres database, **`xpand_e2e`**:
  - created on the dev Postgres container locally;
  - a service container in CI.

Tests use the UI the way an admin does. Through the API, they only set up preconditions that have no screen yet, and read back results the UI can't show.

### 5.2 Test data and isolation

- **Global setup:** drop and recreate `xpand_e2e` → `prisma migrate deploy` → `server/scripts/seed-e2e.ts`.
- **The seed:**
  - a super admin with a known password and no forced change;
  - two instructors:
    - one with **no grants**;
    - one with a grant on category *Cloud* × group *A* (the RBAC case);
  - two groups and five students;
  - two categories.
- **The seed script refuses to run** unless the database name ends in `_e2e`, the same guard as the `_test` rule for integration tests.
- **Each spec creates its own data** with unique names (`run-<id>-…`), so specs never depend on each other or on order, and can run in parallel without wiping the database between them.
- **Logins** are done once per role in setup and reused as Playwright storage state, so most specs start already logged in. The login spec itself does the full login.
- **Time:**
  - The server runs on the real clock; schedules use dates relative to "now" (e.g. opens in 2 days at 10:00 Cairo).
  - A Cairo daylight-saving case is checked through the **preview**, which is pure calculation: a relative schedule across 30 Oct 2026 shows the right wall time.

### 5.3 The specs

| Spec | Proves |
|---|---|
| `auth.spec` | Login, wrong password, forced change and its rules, reload, logout, session expiry returns to login and back to the same page |
| `users.spec` | Create a user → temporary password shown once → that user can log in and is forced to change it. Edit, deactivate (the user's session ends), reset password, search and filters |
| `groups.spec` | Create a group, add members, set a late joiner's join date, remove a member |
| `import.spec` | A CSV with errors shows them and creates nothing; a valid CSV creates everyone; the credentials download works |
| `grants.spec` | Grant *Cloud* × group *A* to an instructor → **log in as that instructor**: menus and lists show only that scope, an out-of-scope URL shows "not found", and the API agrees. Expire the grant → access is gone on the next page load. |
| `catalog.spec` | Categories and tags (rename, archive, delete refused while in use); create an exam, set tags, filter the list, move category |
| `questions.spec` | Add each question type, reorder, import, publish check blocks an invalid exam, publish |
| `assign.spec` | Fixed and relative schedules to a group and to a user; the preview matches what the **student's own exam list** shows afterwards (log in as the student); duplicate assignment refused; bulk all-or-nothing |
| `overrides.spec` | Open now → the student sees it OPEN; close the group → CLOSED; the availability view shows the reason; end the override |
| `audit.spec` | Every action from the specs above appears in the audit screen with actor and target |
| `a11y.spec` | axe on every page (super admin and instructor) |

**Every spec also checks**, through a shared fixture:
- the browser console has no errors;
- no API call returned 5xx;
- no response sent to a student contains `temporaryPassword`, `passwordHash` or `isCorrect`.

### 5.4 Running them

| Where | How |
|---|---|
| Locally | `npm run e2e`: builds server and web, starts them on port 8090 against `xpand_e2e`, runs Playwright, stops them. `npm run e2e -- --ui` for the Playwright UI. Needs the dev Postgres container running. |
| CI | A new `e2e` job after `check`: Postgres service → build → start the server → Playwright (Chromium) → on failure, upload the HTML report, traces and screenshots as artifacts |
| Speed target | The whole suite under 5 minutes in CI |

**Flakiness policy:**
- No `waitForTimeout`; tests wait for the element or response they need.
- Retries are 0 locally and 1 in CI, and a test that only passes on retry is reported and fixed that week.

---

## 6. Phases and order

| Phase | Backend | Frontend | Integration specs | Size* |
|---|---|---|---|---|
| **A0** | BE-6 wire types | Router, Query, kit, shell, test setup | `auth.spec`, CI job | 4 days |
| **A1** | (gaps found while building) | Users, groups | `users`, `groups` | 4 days |
| **A2** | BE-1 stats, BE-2 audit | Dashboard home, audit log | `audit` (grows with each phase) | 3 days |
| **A3** | BE-3 import, BE-5 lookup | Instructors, grant editor, CSV import | `grants`, `import` | 5 days |
| **A4** | — | Categories, tags, exams list and settings | `catalog` | 3 days |
| **A5** | — | Assignments, preview, bulk, overrides, availability | `assign`, `overrides` | 5 days |
| **A6** | BE-4 (= B5 exam content) | Question editor, import, materials, publish | `questions` | 7 days |
| **A7** | — | Polish, accessibility, mobile pass | `a11y`, full suite | 3 days |

\* Working days for one full-stack developer. **About 7 weeks in total.** With a separate backend developer, BE-1 to BE-5 can be built during A0–A1 and the total drops to about 5 weeks.

- **Order:** A0 first. A1 → A3 depend on each other (users before grants). A4 can run alongside A2–A3. A5 needs A4. A6 needs A4.
- **One pull request per phase** (or smaller). CI must be green, including the `e2e` job.

**Definition of done for every phase:**
- [BACKEND_PLAN §8](BACKEND_PLAN.md) for backend changes.
- FRONTEND_GUIDE §5 for screens.
- For integration: every new screen has an integration spec for its main path and its main error.

---

## 7. Exit test (manual, on staging, as the real super admin)

1. Log in → the dashboard home shows correct numbers.
2. Import 10 students from a CSV into a new group *Intake Test*; one has a later join date.
3. Create an instructor, grant *Cloud* × *Intake Test* with `EXAM_ASSIGN` + `EXAM_SCHEDULE`, valid for 7 days.
4. Create the category *Cloud* and the exam *Cloud Gates* with 5 questions; publish it.
5. **As the instructor:** see only *Cloud Gates* and *Intake Test*. Assign the exam relative to the join date (day 14, 10:00, 2 hours). The preview shows the late joiner opening later.
6. **As a student:** the exam list shows *Cloud Gates* as Scheduled at the previewed time.
7. **As the super admin:** open it now for that student with a reason → the student sees it Open; the availability view shows "Opened by override: …".
8. The audit log shows all of the above with the right actors.

When this passes, the tester runs [TEST_PLAN.md](TEST_PLAN.md) §5.1–5.3 on staging, and NEXT_PLAN continues with B6 (attempts).

# Plan: the next phase (finish M1)

This phase finishes **M1** as defined in [NEXT_PLAN.md](NEXT_PLAN.md). Exam content (B5), attempts (B6) and session integrity (B7) are done, along with the frontend for the student dashboard and the exam session (F1–F3); they are on branch `feat/exam-session`. What's left:

| Part | What | Plan |
|---|---|---|
| **B8** | Results, the review flow, manual scores (CTF), standings, the student summary | §3 |
| **B9** | Force submit, void, attempt list, audit scoped for instructors, legacy import | §4 |
| **F4** | Staff screens for all of the above, plus the student summary | §5 |
| **S1** | Security fixes from the OWASP Top 10 review | §6 |

It ends when the **M1 exit test** ([NEXT_PLAN.md §9](NEXT_PLAN.md)) passes on staging and the launch checklist is done (§8).

Everything in [BACKEND_PLAN.md §2 and §8](BACKEND_PLAN.md) still applies:
- the `ApiRouter` pattern;
- thin routes, with rules in pure functions;
- audit in the same transaction;
- RBAC matrix rows for every new route;
- the definition of done.

---

## 0. Before starting

| Step | Why |
|---|---|
| Open the pull request for `feat/exam-session`, let CI pass, merge into `main` | This phase builds on it; long-lived branches drift |
| Start this phase on `feat/results` (B8), then `feat/proctor-audit` (B9) | One pull request per phase keeps reviews small |
| Deploy `main` to staging ([DEPLOY.md](DEPLOY.md)) | Staff can try the exam session on real machines while B8 is built |

---

## 1. Decisions to confirm

These defaults are taken from NEXT_PLAN §1 (E10–E12, E18), except R1, which is new. Say so if one should change.

| # | Question | Recommended default | Why |
|---|---|---|---|
| R1 | Results release: in M1, or wait for B11? | **Ship release and unrelease now** (`POST …/release`, `…/unrelease`, `RESULTS_RELEASE`, audited). The full B11 flow (attempt detail, certificate, export) stays in M2. | The student dashboard and done page already show results once released. Without an endpoint, release would be a raw `PATCH` that is hard to audit. Small: about half a day. |
| R2 | Which attempt counts when `maxAttempts > 1`? | **The latest finished attempt that isn't voided** (as E10 says, and as the dashboard does now) | Consistent with what students already see |
| R3 | Standings (E10, E11) | Total % = Σ (weight × exam %) over **released** exams. Competition ranking (1, 1, 3) within a group. Visible to super admins, and to instructors with `RESULTS_VIEW` on all exams for that group. | Matches the program rules; a partial total misleads |
| R4 | Manual scores (E12) | External exams only, `ATTEMPT_REVIEW`. Stored as a `MANUAL` attempt that is already `REVIEWED`. Re-entering a score replaces it (audited with old → new). | Uses the existing data model |
| R5 | Audit for instructors (E18) | `AUDIT_VIEW` shows entries about exams in the grant's scope and students in its groups. Uses two new indexed columns: `examId`, `subjectUserId`. Older entries remain visible to super admins only. | Can't be scoped efficiently through `entityType`/`entityId` |
| R6 | Void and attempts used | A voided attempt **doesn't count** toward `maxAttempts`; the student may start again while the exam is open, or later through an override | That's the purpose of void (it replaces "Reset Local Attempts") |
| R7 | Force submit reason | **Required**, 3–500 characters, and shown to the student on the done page as "Submitted by the proctor". The reason text itself is staff only. | Students should know why; the details are for staff |

---

## 2. Schema changes (one migration per phase)

**B8:** no new tables.
- `Attempt.reviewStatus`, `reviewedById`, `reviewedAt` and `source = MANUAL` already exist.
- Add `Exam.resultsReleasedAt DateTime?` (R1), keeping `resultsReleased` as the flag.
- Add index `Attempt(examId, status)` for the results lists.

**B9:**
- `AuditLog`: add `examId` and `subjectUserId` (UUID, nullable, indexed with `at`).
  - `audit()` gets optional fields for them.
  - Every exam, assignment, override, attempt and grant action fills them in.
- `Attempt.voidedAt DateTime?` (`voidedById` and `voidReason` exist).
- `Attempt.forcedById String?`.

---

## 3. B8: Results and grading

### API

| Endpoint | Access | Does |
|---|---|---|
| `GET /api/results/exams/:examId?groupId=&status=&reviewStatus=&cursor=` | SA; `RESULTS_VIEW` on the exam; rows only for students in the same grant's reach | One row per assigned student: progress (`NOT_STARTED` / `IN_PROGRESS` / `SUBMITTED` / `MISSED`), attempt status, score, %, pass/fail against `passMark`, submitted at, strikes, review status. Plus exam summary: count, average, pass rate. |
| `GET /api/results/students/:userId` | SA; `RESULTS_VIEW`, only exams in scope | One student across exams |
| `GET /api/results/standings?groupId=` | R3 | Rows: total %, completed count, rank, per-exam % |
| `PATCH /api/attempts/:id/review { reviewStatus, reason? }` | SA; `ATTEMPT_REVIEW` on the exam and student | PENDING → UNDER_REVIEW → REVIEWED. Back to UNDER_REVIEW only with a reason. |
| `PUT /api/results/exams/:examId/scores { entries: [{ userId, score, maxScore }], dryRun = true }` | SA; `ATTEMPT_REVIEW` (R4), external exams only | All or nothing. A dry run returns per-row errors (not assigned, out of scope, score > max). |
| `POST /api/results/exams/:examId/release`, `/unrelease` | SA; `RESULTS_RELEASE` (R1) | Sets `resultsReleased` and `resultsReleasedAt`; audited |
| `GET /api/student/dashboard` | Student | `{ summary: { rank, cohortSize, totalPercent, completed, total }, exams: [...] }` in the shape from the frontend guide. The summary counts released exams only. |

### Rules (pure functions, unit tested)

| Function | Rule |
|---|---|
| `progressOf(assignment state, attempts, now)` | `MISSED` means the window closed with no finished attempt. Voided attempts are ignored. |
| `countingAttempt(attempts)` | R2 |
| `standings(students, exams, attempts)` | R3. Exams without a counting attempt count as 0% once released. Ties share a rank. |
| `nextReviewStatus(current, requested, reason)` | Forward only; going back to UNDER_REVIEW needs a reason |
| `validateScores(entries, exam, scope)` | R4 |

### Isolation (the main risk in this phase)

Results lists leak data easily through **counts, averages and page totals**. Every aggregate is computed **after** scope filtering, in the same query. Tests cover all 8 RBAC actors from `rbac-world.ts`:
- a student outside the grant's groups never appears, not even in `total` or the average;
- a `studentsWhoSubmitted` grant sees only those students.

*Size: 5 days (4 + release).*

---

## 4. B9: Proctor actions, audit, legacy data

### API

| Endpoint | Access | Does |
|---|---|---|
| `GET /api/attempts?examId=&status=&cursor=` | SA; `PROCTOR` or `RESULTS_VIEW` | Attempts in scope: student, status, started, deadline, strikes, last heartbeat. The live board comes in B10. |
| `POST /api/attempts/:id/force-submit { reason }` | SA; `PROCTOR` on the exam and student | Same finalize path as the student's submit: graded, status `FORCE_SUBMITTED`, `submitReason = "proctor"` (R7). Idempotent. |
| `POST /api/attempts/:id/void { reason }` | SA; `ATTEMPT_VOID` | Any finished attempt → `VOIDED` (R6). Can't void an attempt in progress: force-submit it first. |
| `GET /api/attempts/:id/violations` | SA; `PROCTOR` or `RESULTS_VIEW` | The attempt's events in time order (for disputes) |
| `GET /api/audit?…&examId=&subjectUserId=` | SA; `AUDIT_VIEW` scoped per R5 | Extends the existing endpoint; instructors get only rows they reach |

### Races to get right

- **Force submit vs. the student's submit vs. the sweeper:** all three use the existing conditional update (`where status = IN_PROGRESS`). The first one wins; the others return the final state, never an error or a second grade.
- **Void vs. a new start:** after a void, `POST /api/attempts` gives `attemptNo + 1`. The `@@unique([examId, userId, attemptNo])` constraint stops a double start.
- **Student page after force submit:** the next heartbeat or save gets `ATTEMPT_CLOSED`, and the page moves to the done page with the reason "Submitted by the proctor".

### Legacy data import

`npm run import-legacy -w server -- grades.csv [--apply]` reads the old Grades sheet as CSV and creates:
- `MANUAL` attempts, matched to users by **username, never by name**;
- the groups' intake dates.

It does a dry run by default, reporting unmatched, duplicate and out-of-range rows, then writes all or nothing with `--apply`. The import is audited.

*Size: 4 days.*

---

## 5. F4: Screens

| Screen | Route | For |
|---|---|---|
| **Exam results** | `/exams/:id/results` (new tab in the exam layout) | Table with filters (group, status, review status), summary tiles, CSV later (B11). Row → student detail. Release / unrelease button (with confirmation) when allowed. |
| **Enter scores** | `/exams/:id/scores` (external exams only) | Paste or upload CSV → dry-run table with errors → save |
| **Attempts and proctor actions** | `/exams/:id/attempts` | In-progress and finished attempts; Force submit and Void with a reason dialog; violations drawer |
| **Review** | In the results row | PENDING / UNDER_REVIEW / REVIEWED control |
| **Standings** | `/groups/:id/standings` (SA), `/standings?groupId=` (instructors per R3) | Ranked table, per-exam columns |
| **Student summary** | `/student` header | Rank (e.g. "2 of 26"), total %, completed exams. Released exams only. |
| **Done page** | `/exam/:id/done` | New reason text: "Submitted by the proctor" |
| **Audit** | `/audit` for instructors with `AUDIT_VIEW` | The existing viewer with scoped data and exam/student filters |

The navigation shows each item only when `/api/me/permissions` allows it. Every page gets axe checks and is checked at phone width, like the current e2e suite.

*Size: 6 days, partly in parallel with B9.*

---

## 6. S1: Security fixes (from the OWASP Top 10 review)

From the static review (dependency audit and source review). The live scan (ZAP and probes) still has to run once Docker works, and its findings are added here.

| # | OWASP | Finding | Fix |
|---|---|---|---|
| S1.1 | A06 | Vulnerable dependency versions (zod, body-parser, qs, prisma; vite and source-map-js in dev) | Upgrade to fixed versions (zod ≥ 4.6.7, prisma ≥ 7.10.1, vite ≥ 8.3.5). Make `npm audit --omit=dev --audit-level=high` a CI gate. |
| S1.2 | A04 | Anyone can lock a student out for 15 minutes with 5 wrong passwords, for example just before an exam | Lock per **username + IP** instead of per username. Keep the per-IP rate limit. Super admins can unlock from the user page. |
| S1.3 | A07 | `ACCOUNT_LOCKED` reveals that a username exists | Return the same 401 for unknown users after 5 tries, or lock unknown usernames the same way |
| S1.4 | A07 | bcrypt ignores everything after 72 bytes, so long passwords are silently weaker | Reject new passwords over 72 bytes (UTF-8), or pre-hash with SHA-256 before bcrypt for new hashes |
| S1.5 | A09 | A password typed into the username field is stored in the audit log on a failed login | Log usernames only when they match an account; otherwise log a hash or "unknown" |
| S1.6 | Info | Question images on outside sites reveal students' IP addresses to those sites | Use EXAM-8 uploads in M2. Until then, document it, and set `referrerPolicy="no-referrer"` on question images. |
| S1.7 | A08 | Integrity of the CI and Docker images not yet checked | Pin GitHub Actions by commit SHA, pin base images by digest, `npm ci` only |
| S1.8 | — | Live OWASP scan | ZAP baseline and active scan against a production build, plus scripted probes for each category. Report in `docs/security/OWASP_REPORT.md`. |

*Size: 2–3 days.*

---

## 7. Tests

| Level | Covers |
|---|---|
| Unit | Every pure function in §3; coverage gate like `attempts` (lines 95, branches 90) for `results` |
| Integration | Every new route × the 8 RBAC actors (matrix rows); isolation of aggregates; force-submit/submit/sweeper races; void then restart; manual score dry run and apply; audit scoping; legacy import against a sample sheet with unmatched and duplicate rows |
| E2E | **The M1 exit test** as one Playwright spec. A new `results-lifecycle.spec.ts`: take an exam → results table → review → release → the student sees the score; force submit from staff while the student is in the exam; void → the student retakes. |
| Load | k6, 60 students for 60 minutes (NEXT_PLAN §9), plus a results page under load |

---

## 8. Done when

1. B8, B9, F4 and S1 are merged into `main`, CI is green, and the docs (`API.md`, `FRONTEND_GUIDE.md`) are updated in the same pull requests.
2. The **M1 exit test** passes on staging (NEXT_PLAN §9), including step 5: the instructor sees only *Cloud Gates* results for *Group A*.
3. The OWASP report has no open High or Critical findings.
4. Launch checklist:
   - load test met (p95 under 300 ms, no lost answers, the sweeper finalizes everyone at the deadline);
   - backup restore tested;
   - dry run on the classroom machines;
   - legacy grades imported and checked by the academy.

---

## 9. Timeline

| Week | Backend | Frontend |
|---|---|---|
| 1 | §0, B8 rules and results endpoints | Results table (with mocks) |
| 2 | B8 review, scores, release, student summary; S1.1–S1.5 | Results, scores, standings, student summary |
| 3 | B9 force submit, void, attempt list, audit scoping | Attempts and proctor actions, audit for instructors |
| 4 | Legacy import, S1.7–S1.8, load test, fixes | E2E exit test, accessibility, phone width |
| 5 | Staging, dry run, launch | — |

**About 4 weeks of work plus 1 week for staging and launch**, for one backend and one frontend developer. M2 (B10 live board, B11 full results release and export, B12 program operations) starts after launch.

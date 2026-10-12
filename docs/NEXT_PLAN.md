# Plan: the remaining features (finish M1, then M2 and M3)

This plan follows [BACKEND_PLAN.md](BACKEND_PLAN.md). Its phases B0–B4 are done: foundations, access control, catalog, assignment and scheduling, and infrastructure. This plan covers **every feature from the project roadmap that isn't built yet**, numbered as in the roadmap (`SESS-3`, `RES-5`, …).

Phases are named **B5 to B14** (backend), with a frontend track **F1 to F5** that follows them.

| Milestone | Backend phases | Ends with |
|---|---|---|
| **M1: MVP** | B5 exam content → B6 attempts → B7 session integrity → B8 results → B9 proctor and audit | The M1 exit test (§9) passes end to end |
| **M2: proctoring and operations** | B10 live proctoring → B11 results and student extras → B12 program operations | Test plan §5.5–5.6 pass |
| **M3: maximum lockdown** | B13 lockdown → B14 extras | Safe Exam Browser exam taken in the classroom |

Everything in [BACKEND_PLAN.md §2 and §8](BACKEND_PLAN.md) still applies:
- the `ApiRouter` pattern;
- thin routes, rules in pure functions;
- audit in the same transaction;
- RBAC matrix rows for every new route;
- the definition of done.

---

## 0. Before B5: ship what exists

| Step | Why |
|---|---|
| Commit B0–B4 on a branch (one commit per phase), push, open a pull request | Nothing is committed yet; CI has never run on GitHub |
| Fix whatever CI finds; protect `main` | Every later phase relies on CI as the gate |
| Staging deploy on EC2 following [DEPLOY.md](DEPLOY.md): real domain (TLS), CloudWatch logs, S3 backup upload | These three were never tested for real |
| Mark the finished endpoints as final in [FRONTEND_GUIDE.md](FRONTEND_GUIDE.md) | The frontend can start F1 now (see §8) |

---

## 1. Decisions to confirm

**Confirmed 2026-10-12.** You answered E3 (no: pools stay in M2), E5 (no "allow resume" at all), E6, E7, E9 (yes), E14 (make the penalties configurable) and E20 (no: keep webcam snapshots in M3). The other decisions use the recommended default; say so if one should change.

### Exam content and grading

| # | Question | Recommended default | Why |
|---|---|---|---|
| E1 | Can questions be edited after students have taken the exam? | **Text and image fixes only.** Once an exam has any attempt, adding or removing questions, changing options, the correct answer or points is refused (409). To change those: duplicate the exam. | Grades stay explainable. No snapshot or regrading machinery is needed in M1. |
| E2 | How is a multiple-choice question (several correct options) scored? | **All or nothing:** full points only when exactly the correct options are selected | Simple to explain; no negative-marking debates |
| E3 | Question pools (`questionsPerAttempt`, EXAM-7) | **Stays in M2 (B12).** Uniform random draw of N questions at start, stored on the attempt (`questionOrder`); pools by tag later. Until B12, publishing an exam with `questionsPerAttempt` set is refused, so the setting is never silently ignored. | Confirmed: not moved into M1 |

### Session rules

| # | Question | Recommended default | Why |
|---|---|---|---|
| E4 | What ties an attempt to one device? | **The login session** that started it. Reloading, or closing and reopening the same browser, continues the attempt: the session cookie lasts up to 12 hours (20 idle minutes). A request from **any other session** (another device, another browser, a private window) is refused with `ATTEMPT_IN_PROGRESS_ELSEWHERE` and recorded as `DEVICE_CHANGE` (a strike). The original device keeps working. | No extra token to lose; the session cookie is already `HttpOnly` |
| E5 | Can an attempt move to another device? | **No. There is no "allow resume".** PROC-4 is removed from the roadmap. If the original device is lost (crash, battery), the attempt can't be continued: the sweeper submits it at the deadline with the answers saved so far. Staff then choose: keep that result, or **void** it (PROC-5) so the student can start a new attempt while the exam is open, or later through a make-up (ASN-6). | Confirmed: strictest option; no attempt ever changes hands |
| E6 | Does the timer stop while a student is disconnected? | **No.** The deadline is fixed when the attempt starts; the proctor can add time (PROC-3). | Confirmed. A pausing timer can be abused (pull the cable, look things up, reconnect) |
| E7 | Start 5 minutes before the window closes: how long does the student get? | **Until the window closes:** `deadlineAt = min(start + duration + extra time, window close)`. Manual openings (overrides) with no end time give the full duration. | Otherwise "the window" means nothing |
| E8 | Grace period for a save that arrives just after the deadline | **5 seconds** (network delay). After that, saves are refused and the attempt is finalized. | Fair to slow connections, still strict |
| E9 | Which cheating signals count as strikes? | The strike table in §4 (B7): leaving fullscreen, hiding the tab, losing focus, shrinking the window and a device change count. Blocked actions (copy, right-click, shortcuts) and suspected DevTools are **logged only**. **One action = at most one strike:** signals within 3 s are merged. | One Alt+Tab fires blur, tab-hidden and fullscreen-exit together; counting it 3 times auto-submits on the first mistake |

### Results and program rules

| # | Question | Recommended default | Why |
|---|---|---|---|
| E10 | How are the total and the rank calculated (RES-5)? | **Total % = Σ (exam weight × exam %)** over graded exams, matching the program rules (5 topics × 15 + CTF 25). The rank is **competition ranking (1, 1, 3) within a group**. The dashboard shows the rank in the student's first group (earliest intake date). | Matches the legacy rules and the "2 out of 26" display |
| E11 | Who can see standings (totals across exams)? | Super admin, and instructors with `RESULTS_VIEW` on **all exams** for that group. Others see per-exam results only. | A total built from part of the exams is misleading |
| E12 | Entering CTF and other external scores (EXAM-5) | `ATTEMPT_REVIEW` on the exam and the student's group; stored as a `MANUAL` attempt that is already `REVIEWED` | Uses the existing permission and data model |
| E13 | Certificate and removal rules (RES-6) | Certificate: total ≥ 80% **and** every non-external exam ≥ its pass mark (default 80). **Removal flag:** below the pass mark in 3 or more exams. A flag only: **a person decides.** | Rules from the legacy rules page; removal is too serious to automate |
| E14 | Attendance and warning penalties (OPS-2, OPS-3) | **Configurable by the super admin** (program rules settings, B12): the penalty for the 1st, 2nd, … absence and warning, whether penalties add up, and the count that raises the removal flag. Defaults are the legacy rules: absences −5 / −10 / removal flag at the 3rd; warnings 0 / −10 / removal flag at the 3rd; added up; excused absences free. | Confirmed: the rules may change between intakes |
| E15 | Who records attendance and warnings? | **Super admin only in M2.** A group-scoped permission (`ATTENDANCE_MANAGE`) can follow if instructors need it. | Keeps M2 small; easy to extend with the existing grant model |
| E16 | Make-up exams (ASN-6) | A personal assignment marked `isMakeup`. **At most one make-up per student** for the whole program (database-enforced). | "Only one make-up assessment is allowed" |

### Proctoring, audit and files

| # | Question | Recommended default | Why |
|---|---|---|---|
| E17 | Live proctor board updates (PROC-1) | **Polling every 5 s** in M2; Server-Sent Events only if load testing shows a need | One container, a few dozen students: polling is simple and cheap |
| E18 | What can an instructor with `AUDIT_VIEW` see? | Entries about **exams in their grant's scope** and **students in their groups**. Two new columns on `AuditLog`: `examId`, `subjectUserId` (filled from now on). Older entries: super admin only. | `entityType` + `entityId` can't be scoped efficiently |
| E19 | Where do uploaded images go (EXAM-8)? | A Docker volume `uploads`, served by the API to logged-in users only, included in `backup.sh` | No new AWS service; images are only shown to authorized users |
| E20 | Webcam snapshots (SESS-19) | **Kept in M3 (B13)**, off by default per exam. Requires, before go-live: a privacy notice and consent text approved by the academy, and a retention period (default 30 days, then deleted automatically). | Confirmed: keep it. Personal data, so consent and retention are part of the feature, not an afterthought |

---

## 2. B5: Exam content (EXAM-2, EXAM-4, EXAM-5 setup)

**Goal:** an exam can hold questions and materials, and can't be published broken.

### API

| Endpoint | Access | Notes |
|---|---|---|
| `GET /api/catalog/exams/:id/questions` | `EXAM_EDIT` on the exam | Staff view, **includes `isCorrect`** |
| `POST /api/catalog/exams/:id/questions` | `EXAM_EDIT` | `{ type, text, imageUrl?, points, options: [{ text, isCorrect }] }` |
| `PATCH /api/catalog/questions/:id` | `EXAM_EDIT` on its exam | Structure locked after the first attempt (E1) |
| `DELETE /api/catalog/questions/:id` | `EXAM_EDIT` | Refused after the first attempt |
| `PUT /api/catalog/exams/:id/questions/order` | `EXAM_EDIT` | `{ questionIds }`: the complete list, in order |
| `POST /api/catalog/exams/:id/questions/import` | `EXAM_EDIT` | JSON (or CSV) of questions, **all or nothing**, row errors reported like the user import |
| `GET/POST /api/catalog/exams/:id/materials`, `PATCH/DELETE /api/catalog/materials/:id` | `EXAM_EDIT` | `{ title, url }`, https URLs only |
| `POST /api/catalog/exams/:id/duplicate` | `EXAM_EDIT` on the exam and its category | Copies settings, questions and materials as a new DRAFT (the way to change a locked exam) |

### Rules (pure functions, unit-tested)

**Question validity:**
- `SINGLE_CHOICE`: 2–10 options, exactly 1 correct.
- `MULTI_CHOICE`: 2–10 options, at least 1 correct.
- `TRUE_FALSE`: exactly 2 options ("True", "False"), 1 correct.
- Points > 0.

**Publish check:** `PATCH status: PUBLISHED` is refused (409 with the list of problems) unless:
- the exam is external; or
- it has at least one question, every question is valid, and `questionsPerAttempt` is empty (until B12 adds question pools, E3).

**Edit lock (E1):** any attempt on the exam → only `text` and `imageUrl` of questions and options can change.

**Student side:** materials appear in `GET /api/student/exams` (title and URL), only for exams the student can see. This is STU-3.

### Tests

- Validity and publish-check tables.
- The edit lock with an existing attempt.
- Import is all or nothing.
- Duplicate creates a DRAFT.
- RBAC matrix rows for every route.
- **Leak guard:** a student can't reach any of these routes.

*Size:* 4 days.

---

## 3. B6: Attempts, the server-enforced core (SESS-1 to SESS-5, SESS-9, EXAM-6, RES-1)

**Goal:** a student starts, answers and submits exactly once. The server owns the clock, the questions and the grade.

### 3.1 Student API (names agreed in the frontend guide)

| Endpoint | Does |
|---|---|
| `GET /api/student/exams/:examId` | Pre-check page: title, duration, question count, strike limit, rules, whether a PIN is needed, availability |
| `POST /api/attempts { examId }` | Starts the attempt. If the student already has one in progress **in this session**, returns that one (200) instead of failing. |
| `GET /api/attempts/:id` | Resumes after a reload: questions in this attempt's order, saved answers, `deadlineAt`, `serverNow`, strikes. Once submitted: **409 `ATTEMPT_SUBMITTED`** with `submittedAt`, never the questions. |
| `PUT /api/attempts/:id/answers/:questionId { selectedOptionIds }` | Saves one answer (idempotent upsert) |
| `POST /api/attempts/:id/submit` | Submits, grades, returns `{ submittedAt }` (no score unless results are released) |

**Start (`POST /api/attempts`) checks, in one transaction:**
1. `resolveAvailability` says `OPEN` → otherwise `EXAM_NOT_OPEN`.
2. Attempts used up → `ALREADY_SUBMITTED`.
3. An attempt in progress in another session → `ATTEMPT_IN_PROGRESS_ELSEWHERE` (and the device rule of B7 applies).
4. It then:
   - shuffles questions and options per the exam settings, storing `questionOrder` and `optionOrder`;
   - sets `deadlineAt` (E7) and binds the attempt to the session (E4);
   - writes the audit entry.

The existing partial unique index (one `IN_PROGRESS` attempt per student and exam) turns a double click or two tabs into one attempt plus one `CONFLICT`. It's never two attempts.

**No going back (SESS-9):** when `allowBackNavigation` is false:
- answering question *n* closes questions 1 to *n − 1*;
- saving a closed question → `QUESTION_CLOSED`;
- `GET` returns only the current question and the ones after it.

### 3.2 The attempt state machine

```
IN_PROGRESS ──submit──────────────► SUBMITTED
     │ ──deadline / strike limit──► AUTO_SUBMITTED
     │ ──proctor──────────────────► FORCE_SUBMITTED      (B9)
any ──void (reason)──────────────► VOIDED               (B9; doesn't count toward maxAttempts)
```

- **Every transition is a compare-and-set:** `UPDATE … WHERE id = $1 AND status = 'IN_PROGRESS'`, inside the transaction that grades. If submit, auto-submit and force-submit race, exactly one wins; the others see the final state.
- **Grading happens in the same transaction as the transition** (RES-1): `score`, `maxScore`, `reviewStatus = PENDING`. Grading is a pure function: `grade(questions, answers) → { score, maxScore, perQuestion }`. Unanswered = 0; E2 for multi-choice.
- **Answers after the end:** a save after `deadlineAt + 5 s` (E8), or on a non-`IN_PROGRESS` attempt → `ATTEMPT_CLOSED`. A save may only use option IDs that belong to that question **and** were delivered in this attempt.

### 3.3 Finalizing overdue attempts

Overdue attempts are finalized in two ways, both calling the same idempotent function, `finalizeOverdue(attemptId)`:
- **Lazily:** any request that touches an attempt past its deadline finalizes it first.
- **A sweeper:** every 15 s, in the app process, it finalizes all `IN_PROGRESS` attempts past `deadlineAt`. It takes a Postgres advisory lock, so a second container never runs it twice. It uses the injected clock, so tests drive it directly.

### 3.4 Never leaking the answer key

- Student responses are built only by `toStudentQuestion()`, an explicit list of allowed fields, never by spreading database rows.
- **Leak test:** a test walks every route a student can call, in every attempt state. It fails if any response body contains `isCorrect`, `correct`, `points` per option, or any question that wasn't delivered.

### 3.5 Tests

**Unit:** `grade()` tables; drawing and shuffling (deterministic with a seeded random source); deadline rules (E7, E8).

**Property-based (fast-check), random sequences of start / save / submit / clock jump / sweeper / second tab:**
- never two `IN_PROGRESS` attempts;
- no save is accepted after the end;
- a finished attempt never changes status (except void);
- the score is set exactly when the attempt leaves `IN_PROGRESS`;
- `GET` after submit never returns questions.

**Concurrency (integration):**
- 10 parallel starts → 1 attempt.
- Submit racing the sweeper → one transition and one audit entry.
- Parallel saves to the same question → the last write wins and nothing is lost.

**Availability:** after submission the student sees `SUBMITTED` and progress `ANSWERED` (already implemented in the resolver; now proven end to end).

**Coverage gate:** 95% for `attempts/` and `grade.ts`.

*Size:* 7–8 days.

---

## 4. B7: Session integrity (SESS-6, SESS-7, SESS-12 to SESS-16 server side)

**Goal:** the server decides what each cheating signal costs; one device per attempt.

### API

| Endpoint | Access | Does |
|---|---|---|
| `POST /api/attempts/:id/events { type, detail, clientTime }` | Student, own attempt | Records a violation, applies the strike policy, returns `{ strikes, strikeLimit, action: "WARN" \| "AUTO_SUBMITTED" \| "LOGGED" }` |
| `POST /api/attempts/:id/heartbeat` | Student, own attempt | Updates `lastHeartbeatAt`; returns `{ active, status, deadlineAt, serverNow }` |

### Strike policy (a pure function: `applyEvent(attempt, event, now)`)

| Signal | Counts as a strike |
|---|---|
| `FULLSCREEN_EXIT`, `TAB_HIDDEN`, `WINDOW_BLUR`, `RESIZE` | Yes, merged: at most **one strike per 3 s** (E9) |
| `DEVICE_CHANGE` | Yes (see below) |
| `CLIPBOARD`, `CONTEXT_MENU`, `BLOCKED_SHORTCUT`, `DEVTOOLS` | No, logged only (the action was blocked, or the detection is unreliable) |
| `HEARTBEAT_MISSED` | No, logged by the sweeper once per gap of over 30 s, and shown to the proctor as "disconnected" |

- **Every event is stored**, including merged ones. The client can't decide `countsAsStrike`.
- Reaching `strikeLimit` → `AUTO_SUBMITTED` with `submitReason: "strike limit"`, through the same compare-and-set transition as B6.
- Events are rate limited per attempt (60 a minute). Beyond that they are dropped and one `RATE_LIMITED` entry is logged, so a misbehaving client can't flood the database.

### One device (SESS-6)

- Any request for the attempt from a session other than the bound one, including `POST /api/attempts` for the same exam:
  - is refused with **`ATTEMPT_IN_PROGRESS_ELSEWHERE` (409)**, and never receives questions or answers;
  - records `DEVICE_CHANGE` (a strike, merged like the others), so a student who keeps trying from a second device reaches the strike limit.
- The bound session is unaffected and continues normally.
- **No "allow resume" (E5):** the binding never changes. A lost device means the attempt ends at its deadline with the saved answers; staff can void it.
- Logging out during an attempt ends that session, so the attempt can't continue either. The frontend warns before logging out.

### Schema (one migration)

- `Attempt`:
  - add `sessionId` (the binding; replaces `sessionTokenHash`) and `strikeMergedUntil`;
  - drop `deviceFingerprint` (unused; fingerprinting adds privacy cost without real protection).
- `Violation`: add `clientTime`, `ip`.
- New error codes:
  - `EXAM_NOT_OPEN`, `ALREADY_SUBMITTED`, `ATTEMPT_IN_PROGRESS_ELSEWHERE` (409);
  - `ATTEMPT_SUBMITTED`, `ATTEMPT_CLOSED`, `QUESTION_CLOSED` (409);
  - all of them added to the frontend guide's error table.

### Tests

- `applyEvent` tables: merging at 2.9 s vs 3.1 s, the limit, non-strike types.
- Property: strikes never decrease; the attempt is auto-submitted exactly when strikes reach the limit.
- A second logged-in session is refused on every attempt route, gets no questions, adds a `DEVICE_CHANGE` strike, and the first session keeps working.
- Closing and reopening the same browser (same cookie) continues the attempt; logging in again does not.
- The sweeper marks missed heartbeats once.
- RBAC matrix rows: a student can't post events to someone else's attempt (404, not 403).

*Size:* 5 days.

---

## 5. B8: Results and grading (RES-1 finish, RES-2, RES-5, EXAM-5, STU-1, review flow)

### API

| Endpoint | Access | Does |
|---|---|---|
| `GET /api/results/exams/:examId?groupId=&status=&page=` | `RESULTS_VIEW` on the exam; rows limited to students in the grant's groups (RES-2) | Per student: progress, status, score %, submitted at, strikes, review status |
| `GET /api/results/students/:userId` | `RESULTS_VIEW`; only exams in scope | One student across exams |
| `GET /api/results/standings?groupId=` | E11 | Total %, completed count, rank, per-exam % |
| `PATCH /api/attempts/:id/review { reviewStatus }` | `ATTEMPT_REVIEW` on the exam and the student | PENDING → UNDER_REVIEW → REVIEWED (forward only; back to UNDER_REVIEW allowed with a reason) |
| `PUT /api/results/exams/:examId/scores { entries: [{ userId, score, maxScore }] }` | `ATTEMPT_REVIEW` (E12), external exams only | Manual scores (CTF), all or nothing |
| `GET /api/student/dashboard` | Student | `{ summary: { rank, cohortSize, totalPercent, completed, warnings }, exams: [...] }` (shape from the frontend guide) |

### Rules

- **`standings()`** is pure: `(students, exams, gradedAttempts) → rows`. Weights per E10; the latest non-voided attempt per exam counts; ties share a rank.
- **What students see:**
  - Until results are released (B11), scores show as "Pending".
  - **In M1, staff release results by setting `resultsReleased` with `PATCH` on the exam**, so the dashboard is complete. The full release flow comes in B11.
- **Isolation tests:** students outside the grant's groups never appear, not even in counts or page totals (same pattern as the B1 list endpoints).

*Size:* 5 days.

---

## 6. B9: Proctor actions, audit viewer, legacy data (PROC-2, PROC-5, OPS-1 viewer, M0 migration)

### API

| Endpoint | Access | Does |
|---|---|---|
| `POST /api/attempts/:id/force-submit { reason }` | `PROCTOR` | Same transition as B6, status `FORCE_SUBMITTED` |
| `POST /api/attempts/:id/void { reason }` | `ATTEMPT_VOID` | `VOIDED`. The attempt no longer counts, so the student can start again if the exam is still open. **This replaces "Reset Local Attempts".** |
| `GET /api/attempts?examId=&status=` | `PROCTOR` or `RESULTS_VIEW` | Attempts in scope (a simple list; the live board comes in B10) |
| `GET /api/audit?actorId=&action=&examId=&subjectUserId=&from=&to=&page=` | Super admin; instructors with `AUDIT_VIEW` scoped per E18 | Read-only; newest first |

### Legacy data migration

`scripts/import-legacy.ts` takes the old Grades sheet as CSV and creates:
- `MANUAL` attempts with scores, matched to users by **username, never by name**;
- the groups' intake dates.

It does a dry run by default and reports unmatched rows, then `--apply`.

### Schema

- `AuditLog`: add `examId` and `subjectUserId` (indexed). `audit()` gets optional fields for them, and every exam, assignment, override and attempt action fills them in.

### Tests

- Force-submit racing a student's submit.
- A voided attempt doesn't count toward `maxAttempts`.
- Audit scoping isolation, with the 8 RBAC actors.
- The import against a sample sheet that includes unmatched and duplicate rows.

*Size:* 4 days.

---

## 7. M2 and M3 phases

### B10: Live proctoring (PROC-1, PROC-3, SESS-8, SESS-17, SESS-18)

- **Live board:** `GET /api/proctor/live?examId=` (`PROCTOR`) lists every `IN_PROGRESS` attempt in scope. Each row shows:
  - time left, last heartbeat (seconds ago), strikes;
  - the latest violation, and whether a second device was refused.

  The client polls every 5 s (E17). One query with indexes; measured in the load test.
- **Extra time:** `POST /api/attempts/:id/extend { minutes, reason }` (`PROCTOR`, 1–120 minutes) moves `deadlineAt` and records `extraMinutes`.
- **Access code (SESS-8):** the exam setting `accessCode` is hashed into the existing `accessCodeHash`. `POST /api/attempts` then needs `{ accessCode }`, and wrong codes are rate limited like logins. Staff can rotate it.
- **Watermark (SESS-17):** frontend only. The attempt payload already has the student's name and username.
- **DevTools detection (SESS-18):** frontend heuristics, reported as `DEVTOOLS` (logged, no strike, E9).

*Size:* 4 days.

### B11: Results release and student extras (RES-3, RES-4, RES-6, RES-7, STU-4, STU-6)

- **Release:**
  - `POST /api/results/exams/:examId/release` and `/unrelease` (`RESULTS_RELEASE`), audited;
  - `resultsReleasedAt` is added to the exam;
  - students see scores only for released exams, and standings for students count released exams only.
- **Attempt detail (RES-4):** `GET /api/attempts/:id/detail` (`RESULTS_VIEW`) returns answers with correct/incorrect, time per question (from answer timestamps), violations and heartbeats. **Staff only.**
- **Certificate:** `certificateStatus()` is pure (E13): `ELIGIBLE` / `NOT_YET` / `NOT_ELIGIBLE` plus the removal flag. It's shown in standings and on the student scorecard.
- **CSV export:** `GET /api/results/exams/:examId/export.csv` and `/api/results/standings/export.csv`, with the same scope as the list. It uses the existing CSV helper, which already handles formula injection.
- **Student pages:**
  - `GET /api/student/scorecard`: released results, total, rank, certificate status (STU-4).
  - `GET /api/student/activity`: the student's own audit entries, which needs `subjectUserId` from B9 (STU-6).

*Size:* 5 days.

### B12: Program operations (OPS-2, OPS-3, OPS-4, STU-5, ASN-6, ASN-8, USR-5, EXAM-8)

| Feature | API | Notes |
|---|---|---|
| Program rules settings (E14) | `GET /api/settings/program-rules`, `PUT /api/settings/program-rules` | Super admin. `{ absencePenalties: [5, 10], warningPenalties: [0, 10], cumulative: true, removalAfterAbsences: 3, removalAfterWarnings: 3 }`, validated with Zod, stored in one settings row, changes audited. Scores are recalculated from the current rules on every read, so a change applies to everyone at once. |
| Attendance (OPS-2) | `PUT /api/attendance { date, entries: [{ userId, status }] }`, `GET /api/attendance?groupId=&from=&to=` | Super admin (E15). The attendance score comes from a pure function `attendanceScore(records, warnings, rules)` (E14). |
| Warnings (OPS-3) | `POST /api/users/:id/warnings { reason }`, `GET /api/users/:id/warnings`, `DELETE` (revoke, with a reason, audited) | The 3rd warning raises the removal flag (E13, E14) |
| Missed exams to review | `GET /api/results/missed?groupId=` | Students with `MISSED` exams and no make-up, for the "unexcused absence" rule; staff decide on a warning |
| Admin stats (OPS-4) | `GET /api/admin/stats` | Users, active sessions, attempts in progress, open removal flags |
| Rules acceptance (STU-5) | `POST /api/me/accept-rules { version }` | `User.rulesAcceptedVersion`. Students who haven't accepted the current version get `RULES_ACCEPTANCE_REQUIRED` on everything except login, logout and this route (like the forced password change). |
| Question pools (EXAM-7) | `questionsPerAttempt` on the exam | Random draw of N questions at start (E3); the publish check then allows it (N ≤ the number of questions) |
| Make-up and extra time (ASN-6) | `isMakeup` and `extraMinutes` on personal assignments | Database-enforced: one make-up per student (E16). Extra time feeds `deadlineAt`. |
| Calendar (ASN-8) | `GET /api/student/calendar?from=&to=`, `GET /api/assignments/calendar?from=&to=&groupId=` | The same resolver output as the student exam list, by date |
| CSV import (USR-5) | `POST /api/users/import` (JSON rows parsed from the uploaded CSV in the browser) | Reuses the `import-users` script's logic and validation; credentials returned once |
| Image upload (EXAM-8) | `POST /api/uploads` (`EXAM_EDIT`; png, jpeg or webp; max 2 MB; type checked by file content, not name), `GET /api/uploads/:id` (logged in) | Volume per E19; images are re-encoded to strip metadata |

*Size:* 7 days.

### B13: Maximum lockdown (M3: SESS-10, SESS-11, SESS-19)

- **Classroom IP restriction:** an `ipAllowlist` exam setting (list of CIDR ranges). The start, save and event routes check the client IP. Caddy forwards the real IP and `TRUST_PROXY` is already configured.
- **Safe Exam Browser:** with `requireSafeBrowser`, every attempt request must carry `X-SafeExamBrowser-ConfigKeyHash`, equal to SHA-256(full request URL + the exam's config key).
  - A missing or wrong header refuses the start with `SEB_REQUIRED`, and is logged as `SEB_MISSING` during an attempt.
  - Must be tested with a real Safe Exam Browser on the classroom machines before it's relied on.
- **Webcam snapshots (SESS-19)**, per E20:
  - Exam settings `webcamSnapshots` (off by default) and `webcamIntervalSeconds` (default 120).
  - Start requires the consent checkbox **and** camera permission; without them the start is refused (`WEBCAM_REQUIRED`).
  - The browser posts a small JPEG to `POST /api/attempts/:id/snapshots` (student, own attempt, bound session only; max 200 KB; type checked by content). Stored on the `uploads` volume.
  - The camera stopping mid-exam is reported as `WEBCAM_LOST` (logged, not a strike; the proctor sees it).
  - Staff with `PROCTOR` or `RESULTS_VIEW` see the snapshots in the attempt detail; students never do.
  - A daily job deletes snapshots older than the retention period (setting, default 30 days); deletions are audited.

*Size:* 4 days.

### B14: Extras (M3: AUTH-7, RBAC-7, EXAM-9, RES-8, OPS-5)

- **RBAC-7 (read-only proctor): already possible.** A grant with only `PROCTOR` (or `PROCTOR` + `RESULTS_VIEW`) is exactly that. It only needs a preset in the grant editor; no backend work.
- **Google sign-in for staff (AUTH-7):** OpenID Connect, limited to the company domain, linked to existing accounts by email. Students keep passwords.
- **Short-answer questions (EXAM-9):** a `SHORT_ANSWER` type, graded by hand. Attempts with such questions stay `PENDING` until a reviewer scores them, which uses the review flow from B8.
- **Question statistics (RES-8):** per question, percent correct, discrimination (top vs bottom third), and how often each option is chosen. Read-only queries.
- **Email notifications (OPS-5):** Amazon SES, through a small outbox table, so emails are sent after the transaction commits and retried. Events: exam scheduled, results released, warning issued.

*Size:* 8–10 days.

---

## 8. Frontend track

Screens are specified in [FRONTEND_GUIDE.md](FRONTEND_GUIDE.md). Each phase can start once its backend phase lands; mocks are allowed before that.

| Phase | Screens | Needs |
|---|---|---|
| **F1** | App shell with role-based navigation (RBAC-5); users, groups, grants, categories and tags; exam settings; assign and schedule with preview; open and close now | B0–B4 (**available now**) |
| **F2** | Question editor, materials, import, duplicate; student dashboard with exam cards and materials (STU-1 to STU-3) | B5, then B8 for the summary |
| **F3** | The locked-down exam session (guide §4.3) | B6, B7 |
| **F4** | Results, review, manual scores, force submit, void, audit log | B8, B9 |
| **F5** | Live board, release, attempt detail, scorecard, attendance, warnings, calendar, rules acceptance, CSV import, image upload | B10–B12 |

---

## 9. M1 exit test and launch checklist

**Exit test**, run on staging by the tester ([TEST_PLAN.md](TEST_PLAN.md)):
1. The super admin gives an instructor `EXAM_ASSIGN`, `EXAM_SCHEDULE`, `RESULTS_VIEW`, `PROCTOR` on *Cloud Gates* × *Group A*.
2. The instructor schedules it **relative to the join date**. The preview shows each student's window.
3. A student takes it in fullscreen and leaves fullscreen 3 times → auto-submitted on the 3rd strike.
4. The Back button and the old URL show "Submitted", never a question.
5. The instructor sees only *Cloud Gates* results for *Group A*.
6. Every step is in the audit log, seen through the audit viewer.

**Before the first live exam:**
- **Load test** (test plan §5.7) with k6: 60 students for 60 minutes, saving an answer every 10 s, a heartbeat every 10 s, and some events. Target:
  - p95 under 300 ms on the planned EC2 size;
  - no lost answers;
  - the sweeper finalizes everyone at the deadline.
- **Restore test** of the night-before backup.
- **Dry run** with staff acting as students on the classroom machines (fullscreen behaviour differs between browsers and operating systems).

---

## 10. Summary

| Phase | Milestone | Features | Size* |
|---|---|---|---|
| 0 | — | Commit, CI, staging deploy | 1–2 days |
| B5 | M1 | EXAM-2, EXAM-4, STU-3, publish checks | 4 days |
| B6 | M1 | SESS-1 to 5, SESS-9, EXAM-6, RES-1 | 7 days |
| B7 | M1 | SESS-6, 7, 12 to 16 (server) | 4 days |
| B8 | M1 | RES-2, RES-5, EXAM-5, STU-1, review flow | 5 days |
| B9 | M1 | PROC-2, PROC-5, audit viewer, legacy import | 4 days |
| B10 | M2 | PROC-1, PROC-3, SESS-8, SESS-17, SESS-18 | 4 days |
| B11 | M2 | RES-3, RES-4, RES-6, RES-7, STU-4, STU-6 | 5 days |
| B12 | M2 | OPS-2, 3, 4 (configurable rules), STU-5, ASN-6, ASN-8, USR-5, EXAM-7, EXAM-8 | 8 days |
| B13 | M3 | SESS-10, SESS-11, SESS-19 | 6 days |
| B14 | M3 | AUTH-7, RBAC-7, EXAM-9, RES-8, OPS-5 | 8–10 days |

\* Working days for one backend developer who knows the code base. **M1 backend: about 5 weeks.** The frontend runs in parallel and F3 (the exam session) is the long pole, so start F1 now.

**Moved between milestones** compared with the original roadmap:
- **Removed:** PROC-4 "allow resume" (E5). An attempt never moves to another device.
- **Earlier than planned:** AUTH-5, AUTH-6, RBAC-6, USR-6 and ASN-7 were already delivered in B0–B4.
- **Unchanged:** EXAM-7 stays in M2, SESS-19 webcam stays in M3.

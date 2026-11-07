# Plan: exam types and manual grading

Admins choose what kind of exam they are building and how it is scored:

| Exam type | Scoring options | Default |
|---|---|---|
| **MCQ only** (single choice, multi choice, true/false) | **Auto scored** or **Needs approval** | Auto scored |
| **MCQ + essay** | **Needs approval** only | Needs approval (fixed) |

- **Auto scored** works as it does today: `finalize()` grades the attempt on submit and stores `score` / `maxScore`.
- **Needs approval** means no score exists on submit. A grader (super admin, or an instructor with `ATTEMPT_REVIEW`) reviews the attempt, gives points for each essay, and approves it. The score is calculated only when the attempt is approved.

The type is a list (an enum), not a yes/no flag, so more types can be added later (for example essay only, or short answer) without another redesign.

This builds on **B8** in [PHASE_M1_FINISH_PLAN.md](PHASE_M1_FINISH_PLAN.md): it uses the same `ReviewStatus` (PENDING → UNDER_REVIEW → REVIEWED), the same `ATTEMPT_REVIEW` permission, and the results release flow. Everything in [BACKEND_PLAN.md §2 and §8](BACKEND_PLAN.md) still applies:
- the `ApiRouter` pattern;
- thin routes, with rules in pure functions;
- audit in the same transaction;
- RBAC matrix rows for every new route.

---

## Status (2026-11-07, branch `feat/exam-types`)

Built with the defaults in §1 as written. Where the build differs from the text below:

| Planned | Built | Why |
|---|---|---|
| `422 INVALID_SCORING_MODE`, `422 QUESTION_TYPE_NOT_ALLOWED` | `400 VALIDATION_FAILED` (path `scoringMode` / `type`) | The API has no 422; invalid input is 400 everywhere |
| `409 EXAM_LOCKED`, `409 NOT_MANUALLY_SCORED` | `409 CONFLICT` with a readable `message` | Same as the existing lock rules. Only `GRADING_CONFLICT` is a new code. |
| `GET /api/attempts/:id/grading`, `PUT …/grades`, `POST …/approve`, `POST …/reopen` | Under `/api/grading/attempts/:id…`; queue at `/api/grading/exams/:examId` | `/api/attempts` is the student-only session router |
| Grade page at `/attempts/:id/grade` | `/grading/:attemptId` | Matches the API |

**Done:** §2 (migration `20261107203848_exam_types`, with both CHECK constraints), §3.1–3.5, §3.6 for the done page and the student dashboard, §4 except the rows below, §5, and the §6 tests (unit, integration with RBAC matrix rows, and `e2e/exam-grading.spec.ts`). In the exam session, Ctrl+A is allowed inside an essay box; copy, cut and paste stay blocked (T14).

**Not done yet:**

| Item | Waits for |
|---|---|
| §3.6 results list, release `ungradedCount` (T12), standings (T13); B8's review PATCH refusing `REVIEWED` on manual exams | B8: those endpoints don't exist yet. Add the rule when B8 lands. |
| §4 staff dashboard tile "N attempts waiting for grading" | A cross-exam count endpoint (scoped per grant pair) |
| A second e2e spec (MCQ only + needs approval) | Covered by integration tests; add to e2e if wanted |

---

## 1. Decisions to confirm

| # | Question | Recommended default | Why |
|---|---|---|---|
| T1 | Exam types at launch | `MCQ` and `MCQ_ESSAY`. An essay-only exam is `MCQ_ESSAY` with no MCQ questions (allowed). | Covers both requested types. "Essay only" needs no separate type. |
| T2 | Must an `MCQ_ESSAY` exam contain at least one essay to publish? | **Yes**, it is a publish problem: "Add at least one essay question, or change the type to MCQ only." | Otherwise it is an MCQ exam that needs grading for no reason |
| T3 | When can type and scoring mode change? | Freely while the exam has **no attempts**. After the first attempt both are **locked** (same rule as locked question content). Duplicate the exam to change them. | Changing scoring after attempts exist would change scores already given |
| T4 | Changing `MCQ_ESSAY` → `MCQ` while essay questions exist | **Refused** with "Remove the N essay questions first" | No silent deletion of content |
| T5 | MCQ questions inside a "needs approval" attempt | Auto-graded on submit and **shown to the grader pre-filled**. The grader may **override** the points for a question, with a required reason (audited). | Saves grader time and allows fixing a bad answer key |
| T6 | Essay answer format and size | Plain text, max **10,000 characters** per answer, shown with a character counter. No rich text. | Simple, safe to render, fits the 100 kb body limit |
| T7 | Points per essay | 0 up to the question's `points`, in steps of **0.5** | Enough precision without false accuracy |
| T8 | Grader feedback per essay | Stored now (optional, max 2,000 characters). **Shown to students in M2** with the B11 attempt detail. | The data exists when B11 needs it; no extra screen now |
| T9 | Model answer / rubric per essay | Optional `guidance` field, **staff only**, shown next to the answer while grading | Keeps grading consistent between instructors |
| T10 | Two graders on the same attempt | **Optimistic locking**: every save sends the version it read; a stale save gets `409 GRADING_CONFLICT` and reloads | No hidden overwrites, and no lock that can get stuck |
| T11 | Reopening an approved attempt | `REVIEWED → UNDER_REVIEW` only with a reason. The score goes back to **null** until it is approved again. If results were released, the student sees "Under review" again. | A score is never shown while it is being changed |
| T12 | Releasing results with ungraded attempts | **Allowed, after a confirmation** that shows "N attempts are not graded yet". Students see their score only when the exam is released **and** their attempt is approved. | One late essay shouldn't block a whole group |
| T13 | Standings (R3) while attempts are ungraded | An ungraded attempt counts as **pending**, not 0%. The student's total shows "incomplete" until it is graded. | 0% would make the student look like they failed |
| T14 | Students' paste in essays | **Stays blocked** and still counts as a strike, as now | Pasting essays from outside is the main way to cheat at essays |
| T15 | External exams (CTF) | Type and scoring mode are **hidden and fixed** (`MCQ` / `AUTO`); scores are still entered manually (R4) | Neither setting applies to them |

---

## 2. Schema changes (one migration)

```prisma
enum ExamType {
  MCQ        // single choice, multi choice, true/false only
  MCQ_ESSAY  // may also contain ESSAY questions
}

enum ScoringMode {
  AUTO             // graded on submit
  MANUAL_APPROVAL  // graded by staff; score set on approval
}

model Exam {
  // …
  type        ExamType    @default(MCQ)
  scoringMode ScoringMode @default(AUTO)
}

enum QuestionType {
  SINGLE_CHOICE
  MULTI_CHOICE
  TRUE_FALSE
  ESSAY          // new: no options
}

model Question {
  // …
  guidance String? // ESSAY only; staff only, never serialized to students (T9)
}

model AttemptAnswer {
  // …
  selectedOptionIds String[] @default([]) @db.Uuid  // empty for essays
  text              String?                          // ESSAY answer, ≤ 10,000 chars (T6)
  autoPoints        Decimal? @db.Decimal(6, 2)       // MCQ points computed on submit
  awardedPoints     Decimal? @db.Decimal(6, 2)       // grader's points (essays, or MCQ overrides)
  overrideReason    String?                          // required when awardedPoints ≠ autoPoints on MCQ (T5)
  feedback          String?                          // T8
  gradedById        String?  @db.Uuid
  gradedAt          DateTime?
}

model Attempt {
  // …
  gradingVersion Int @default(0) // T10, incremented on every grading save
}
```

In the SQL migration:
- **Existing exams** get `MCQ` / `AUTO`, so today's behavior is unchanged.
- A CHECK constraint enforces the main rule in the database too: `NOT (type = 'MCQ_ESSAY' AND "scoringMode" = 'AUTO')`.
- An index on `Attempt(examId, reviewStatus)` speeds up the grading queue. B8 already plans `Attempt(examId, status)`, so add both in the same migration.

---

## 3. Backend

### 3.1 Exam settings ([exams.service.ts](../server/src/modules/catalog/exams.service.ts))

- `settings` gets `type` and `scoringMode`. Create defaults to `MCQ` + `AUTO`; when `type = MCQ_ESSAY` and no `scoringMode` is sent, it defaults to `MANUAL_APPROVAL`.
- A pure function `validExamScoring(type, scoringMode)` refuses `MCQ_ESSAY` + `AUTO` with `422 INVALID_SCORING_MODE`.
- `updateExam` refuses changes to either field once attempts exist (T3, `409 EXAM_LOCKED`) and refuses T4.
- Both fields are added to `examDto`, audited in `changedFields`, and copied by `duplicateExam`.

### 3.2 Questions ([content.service.ts](../server/src/modules/catalog/content.service.ts))

- `questionProblems` for `ESSAY`: text is required, `points > 0`, **no options**, and `guidance` ≤ 5,000 characters.
- Creating or importing an `ESSAY` question in an `MCQ` exam → `422 QUESTION_TYPE_NOT_ALLOWED`.
- `publishProblems` adds T2.
- `importQuestions` and `duplicateExam` handle `ESSAY` and `guidance`.
- The locked-exam rule is unchanged: after attempts, only wording can change (essay text and guidance count as wording).

### 3.3 Taking the exam ([attempts/service.ts](../server/src/modules/attempts/service.ts))

- `studentView` sends essays as `{ id, type: "ESSAY", text, points, imageUrl }` and the student's saved `text`. It **never** sends `guidance`; extend the existing test that checks `isCorrect` never leaks.
- `answerBody` becomes a union: `{ selectedOptionIds }` for choice questions, `{ text }` for essays (trimmed length ≤ 10,000). Sending the wrong shape for the question type → `422`.
- Saving answers keeps all current guards (deadline, grace period, session binding, row lock against submit).

### 3.4 Submit and scoring

`finalize()` is unchanged up to the compare-and-set, then branches on `exam.scoringMode`:

| Mode | On submit |
|---|---|
| `AUTO` | As today: `grade()` → `score`, `maxScore`. Also writes each answer's `autoPoints`, so the B11 attempt detail can show points per question. |
| `MANUAL_APPROVAL` | `grade()` runs on the **MCQ questions only** and writes `autoPoints` for each answer. `maxScore` is set (the total points of the delivered questions). **`score` stays null.** `reviewStatus` stays `PENDING`. |

Pure functions in `attempts/rules.ts` (unit tested, with the same coverage gate as `attempts`):

| Function | Rule |
|---|---|
| `validExamScoring(type, mode)` | §3.1 |
| `gradeChoices(questions, answers)` | Today's `grade()`, restricted to choice questions; returns points per question |
| `validGrade(question, points, autoPoints, reason)` | `0 ≤ points ≤ question.points`, in 0.5 steps (T7); an MCQ override needs a reason (T5) |
| `approvalProblems(questions, answers)` | Every **answered** essay has `awardedPoints`. Unanswered essays count as 0 automatically. |
| `finalScore(questions, answers)` | Σ over questions of `awardedPoints ?? autoPoints ?? 0`, rounded to 2 decimals |

### 3.5 Grading API

| Endpoint | Access | Does |
|---|---|---|
| `GET /api/grading/exams/:examId?reviewStatus=&groupId=&cursor=` | SA; `ATTEMPT_REVIEW` on the exam, rows only for students in scope | The grading queue: finished attempts of a `MANUAL_APPROVAL` exam with student, submitted at, review status, essays graded (e.g. "2 of 3"), and who graded last. Counts are computed **after** scope filtering (B8 isolation rule). |
| `GET /api/attempts/:id/grading` | SA; `ATTEMPT_REVIEW` on the exam and student | Every delivered question in delivery order: question, guidance, the options with the correct ones marked, the student's answer, `autoPoints`, `awardedPoints`, feedback, plus `gradingVersion` |
| `PUT /api/attempts/:id/grades { version, grades: [{ questionId, points, feedback?, reason? }] }` | Same | Saves a draft. `PENDING → UNDER_REVIEW`. Wrong `version` → `409 GRADING_CONFLICT` (T10). Audited (`attempts.graded`, old → new points). |
| `POST /api/attempts/:id/approve { version }` | Same | Checks `approvalProblems`, sets `score = finalScore(...)`, `reviewStatus = REVIEWED`, `reviewedById`, `reviewedAt`. Audited (`attempts.approved`, with the score). |
| `POST /api/attempts/:id/reopen { reason }` | Same | T11: `REVIEWED → UNDER_REVIEW`, `score = null`. Audited. |

**Rules:**
- None of these routes work on attempts that are still in progress or voided (`409`), or on `AUTO` exams (`409 NOT_MANUALLY_SCORED`).
- B8's `PATCH /api/attempts/:id/review` stays the way to review `AUTO` attempts. On `MANUAL_APPROVAL` exams it refuses `REVIEWED` and points to `/approve`, so approval always computes a score.
- Voiding an approved attempt (B9) works as planned; the voided attempt no longer counts.

### 3.6 Where scores are read

Every place that reads `attempt.score` must treat **null on a finished attempt as "awaiting grading"**, not as 0 or as missing:

| Place | Change |
|---|---|
| `attemptOutcome` (done page) | Adds `awaitingGrading: true` when the exam is `MANUAL_APPROVAL` and the attempt is not `REVIEWED` |
| Student dashboard (`availability.service.ts`) | Status "Submitted, awaiting grading"; the score is shown only when released **and** `REVIEWED` |
| B8 results list | Shows the review status and "—" for the score; the average and pass rate count graded attempts only, and show "N not graded" next to them |
| B8 standings (R3) | T13 |
| B8 release | T12: the response and the confirmation dialog include `ungradedCount` |

---

## 4. Frontend

| Screen | Change |
|---|---|
| **New exam / settings** ([ExamForm.tsx](../web/src/features/exams/ExamForm.tsx)) | New **Exam type** radio group: "Multiple choice only" or "Multiple choice + essay". Below it, **Scoring**: "Auto scored" or "Needs approval". With "+ essay" selected, "Auto scored" is disabled, "Needs approval" is selected, and a note explains why. Both are hidden for external exams. Both are read-only with an explanation once the exam is locked (T3). |
| **Question editor** ([QuestionEditor.tsx](../web/src/features/content/QuestionEditor.tsx)) | "Essay" appears in the type list only for `MCQ_ESSAY` exams. An essay has no options editor; it has an optional "Guidance for graders (students never see this)" field. |
| **Exam session** ([ExamSession.tsx](../web/src/features/session/ExamSession.tsx)) | An essay renders as a labelled `<textarea>` with a character counter (T6). It saves through the existing `saver` with a debounce of about 1.5 s, on blur, and before navigation or submit. Paste stays blocked (T14). Typing, Backspace, and arrow keys must still work, so check `blockedShortcut` doesn't block normal text editing (Ctrl+A, Ctrl+Z, Ctrl+Backspace inside the textarea). The submit dialog lists unanswered essays. |
| **Done page** ([ExamDone.tsx](../web/src/features/session/ExamDone.tsx)) | "Your exam was submitted. Your score will be available after your answers are graded." |
| **Student dashboard** | New status chip "Awaiting grading" |
| **Grading queue** (new) `/exams/:id/grading` | New tab in the exam layout, shown for `MANUAL_APPROVAL` exams to users with `ATTEMPT_REVIEW`. Table: student, group, submitted at, status, essays graded "2/3", last grader. Filters: status, group. Default filter: not yet approved. |
| **Grade attempt** (new) `/attempts/:id/grade` | One question per card, in delivery order. **Essay:** question, guidance, the student's answer (plain text, whitespace kept), points input (0.5 steps), feedback. **MCQ:** the options with the student's choice and the correct ones marked, auto points, and an "Override" link that asks for a reason. A sticky footer shows the running total and has **Save draft**, **Approve** (disabled with the reason until `approvalProblems` is empty), and **Next ungraded**. On `409 GRADING_CONFLICT` it shows "Someone else changed this grading. Reload to see their changes." |
| **Results** (B8, F4) | Review status column; "Grade" action on each row of a `MANUAL_APPROVAL` exam; the release confirmation shows the ungraded count (T12) |
| **Staff dashboard** | Tile "N attempts waiting for grading" (only for users with `ATTEMPT_REVIEW`), linking to the queue |

All screens get axe checks and are checked at phone width, like the current e2e suite. The grading page must stay usable on a tablet.

---

## 5. Security

- **Guidance and correct options must never reach students.** The student view is built field by field; the leak test covers `guidance` and `autoPoints` too.
- Essay text is shown only as **React text**, never with `dangerouslySetInnerHTML`, on both the student and the staff pages (stored XSS from a student to a grader is the main new risk).
- Grading routes use the same scope checks as B8: `ATTEMPT_REVIEW` on **the exam and the student**. Matrix rows are added for all 8 RBAC actors, including an instructor with `ATTEMPT_REVIEW` on the exam but not on the student's group (gets `404`, not `403`).
- Every points change is audited with the old and new values, the grader, and the reason for MCQ overrides.
- The 10,000-character limit is enforced on the server; the 100 kb JSON body limit stays.

---

## 6. Tests

| Level | Covers |
|---|---|
| Unit | Every function in §3.4; the type/scoring rule; the question rules for essays; `finalScore` rounding; `approvalProblems` with unanswered essays |
| Integration | Settings: defaults, the `MCQ_ESSAY` + `AUTO` refusal (API and DB constraint), the lock after attempts, T4. Content: essay not allowed in an `MCQ` exam, publish needs an essay (T2), duplicate and import keep essays. Session: essay save, length limit, wrong answer shape, no `guidance` leak. Submit: `AUTO` unchanged; `MANUAL_APPROVAL` leaves `score` null. Grading: draft → approve → score; reopen clears the score; version conflict; the review PATCH is refused on manual exams; each new route × 8 actors; queue counts after scope filtering. |
| E2E | `exam-grading.spec.ts`: admin creates an MCQ + essay exam (auto-scored option disabled) → student answers MCQ and essay → done page says awaiting grading → instructor grades and approves → release → student sees the score. A second spec: an MCQ-only exam with "Needs approval" → approve with no changes → score equals the auto score. |
| Regression | The existing exam-session and exam-lifecycle specs pass unchanged (existing exams are `MCQ` / `AUTO`) |

---

## 7. Order of work

Do this **after B8 is merged**: it uses B8's review status rules, results list, and release. Branch: `feat/exam-types`.

| Step | What | Size |
|---|---|---|
| 1 | Migration, settings rules, essay questions and publish check (§3.1–3.2) | 1.5 days |
| 2 | Essay answers in the session API and submit branching (§3.3–3.4) | 1.5 days |
| 3 | Grading API, score readers, audit, matrix rows (§3.5–3.6) | 2.5 days |
| 4 | Exam form and question editor | 1 day |
| 5 | Essay answers in the exam session, done page, dashboard chip | 1.5 days |
| 6 | Grading queue and grade attempt screens, results integration | 3 days |
| 7 | E2E specs, accessibility, docs (`API.md`, `FRONTEND_GUIDE.md`, `ARCHITECTURE.md`) | 1 day |

**About 6 days of backend and 6 of frontend**, partly in parallel: about 1.5–2 weeks for one backend and one frontend developer.

---

## 8. Out of scope (later)

- Showing grader feedback and per-question points to students (B11, T8)
- Blind grading (hiding the student's name from the grader) and second-grader moderation
- Rubrics with criteria and levels (today: free-text guidance)
- Other types: short answer with auto-matching, file upload, code questions
- AI-suggested essay scores
- Notifying graders by email when attempts arrive

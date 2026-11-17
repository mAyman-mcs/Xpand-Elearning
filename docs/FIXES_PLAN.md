# Plan: four fixes (picture descriptions, category materials, new assignments, exam history)

| # | Fix | Size | Schema change |
|---|---|---|---|
| 1 | Picture descriptions in exams become optional | Small (½ day) | Yes (drops three CHECK constraints) |
| 3 | A newly assigned exam shows up on the student's screen without a reload | Small (½ day) | No |
| 4 | Users list shows the exams each student took; the user page shows their exam history | Medium (1½ days) | No |
| 2 | A materials page per category, for instructors and students | Medium (2 days) | Yes (one migration) |

Build them in that order: the two small fixes ship first, and fix 2 is the only one with a migration.

Everything in [BACKEND_PLAN.md §2 and §8](BACKEND_PLAN.md) still applies: the `ApiRouter` pattern, thin routes, audit in the same transaction, RBAC matrix rows for every new route, and the definition of done.

---

## 0. Before starting

| Step | Why |
|---|---|
| Merge `feat/tag-bundles-results` into `main` | These fixes touch the same screens (exam pages, user page) |
| One branch per fix: `fix/optional-alt-text`, `fix/student-exams-refresh`, `feat/exam-history`, `feat/category-materials` | Small pull requests, easy to review |

## 1. Decisions taken

| # | Question | Decision |
|---|---|---|
| D1 | What is a "topic"? | A **category**. Every exam has exactly one. |
| D2 | What does a topic's material hold? | **Links only** (title + https link), like today's exam materials. No file uploads. |
| D3 | Who sees a category's materials? | Students: categories of the **published** exams assigned to them. Instructors: categories their grants reach. Super admins: all. |
| D4 | What happens to today's per-exam materials? | They stay. Students see both: the exam's own links, and its category's links. |
| D5 | A picture without a description | Shown as decorative (`alt=""`): screen readers skip it. The field stays, marked "recommended". |
| D6 | Where does exam history show? | A new **Exams taken** column in the Users list (admin) and the Students list (instructor), and a new **Exam history** card on the user's page. |

---

## Fix 1 · Picture descriptions optional

**Today:** a picture on a question, an option or a case must have a description (alt text). The editor shows "Required", saving or publishing is refused, and the server rejects it.

**Change:** remove the rule everywhere, keep the field. The database also enforced it (`Option_image_alt`, `Question_image_alt`, `QuestionCase_image_alt` from the `use_case_questions` migration): migration `20261117120000_optional_picture_descriptions` drops them.

| Where | Change |
|---|---|
| [server/src/modules/catalog/content.service.ts](../server/src/modules/catalog/content.service.ts) | Remove the alt-text checks: question picture (line ~39), option pictures (~45), case picture (~609, ~658, ~679) |
| [web/src/lib/questions.ts](../web/src/lib/questions.ts) | Remove the same two problems from the client-side check (~44, ~50) |
| [web/src/components/Picture.tsx](../web/src/components/Picture.tsx) | `ImageField`: drop `required` and the "Required" error. Label "Describe the picture (optional)"; hint "Recommended: read aloud to students using a screen reader. Don't give away the answer." |
| [web/src/features/content/CaseEditor.tsx](../web/src/features/content/CaseEditor.tsx) | Remove `missingAlt` blocking the save |
| `Picture` (rendering) | Already renders `alt=""` when there is no description. No change. |

**Tests**
- Unit: content service accepts a question, option and case picture with no description; existing tests that expect the refusal are updated.
- Web: the question editor saves a picture with an empty description.
- e2e: `a11y.spec.ts` still passes (a picture with `alt=""` is valid).

---

## Fix 3 · New assignments appear without a reload

**Cause found:** the student's **My exams** page asks the server for its exams once, when it opens. It asks again only when a known exam opens or closes. Window focus doesn't refetch either (`refetchOnWindowFocus: false` in [web/src/lib/query.ts](../web/src/lib/query.ts)). So an exam assigned while the page is open stays invisible until the student reloads or navigates away and back.

**A second cause to rule out first:** a **draft** exam is never shown to students, even when assigned (by design, see `exam-lifecycle.spec.ts` step 1.5). An exam that was "just created" may simply not be published yet.

**Change**

| Where | Change |
|---|---|
| [web/src/features/student/StudentHome.tsx](../web/src/features/student/StudentHome.tsx) | The `studentExams` query gets `refetchInterval: 60_000`, `refetchOnWindowFocus: true` and `refetchOnReconnect: true`. Not while an exam is running: the exam page doesn't use this query. |
| Exam page, **Who and when** tab | On a draft exam, a notice above **Assign**: "This exam is a draft. Students won't see it until you publish it." With a **Publish** link. |
| Assign dialog (draft exam) | The same sentence under the Preview table. |

The server cost is small: one indexed query per open student dashboard per minute.

**Tests**
- Web: `StudentHome` refetches on focus and on the interval (fake timers).
- e2e: student dashboard open → staff assign a published exam → the card appears within the interval, no reload.
- e2e: the draft notice shows on **Who and when** and disappears after publishing.

---

## Fix 4 · Exams taken and exam history

**Today:** the Users list shows name, role, groups, join date and status. The user page shows details, account and groups. A student's attempts can only be found on **Submissions** by searching.

### Backend

| Route | Access | Returns |
|---|---|---|
| `GET /api/users` (existing) | unchanged | Each student row gains `examsTaken`: the number of distinct exams with a submitted attempt, counted within the caller's reach. One `groupBy` on `Attempt` for the page's user ids, not one query per row. |
| `GET /api/users/:id/attempts` (new) | Super admin, or an instructor with `RESULTS_VIEW` or `ATTEMPT_REVIEW` whose grant reaches the student | The student's submitted attempts, newest first, filtered to the caller's reach (reuse `inScope` from the submissions service). Per attempt: exam (id, code, title, category), attempt number, submitted at, status (graded / awaiting grading / voided), score, max score, %, passed, whether results are shown to the student. |

Add both to the RBAC matrix and to [API.md](API.md).

### Frontend

| Where | Change |
|---|---|
| [UsersList.tsx](../web/src/features/users/UsersList.tsx) (admin **Users** and instructor **Students**) | New column **Exams taken** (a number; "—" for staff). Clicking the row opens the user page, as today. |
| [UserDetail.tsx](../web/src/features/users/UserDetail.tsx) | New card **Exam history** for students, under **Details**: one row per attempt with Exam, Attempt, Submitted, Status, Score (e.g. "5 / 6 · 83%"), Passed/Failed, Results shown (yes/no). Empty state: "No exams taken yet." |
| Each history row | Links to the existing submission view (`/submissions/:attemptId`). If it awaits grading and the caller can grade, a **Grade** link goes to `/grading/:attemptId`. |

The admin **Dashboard** keeps its totals. Its "People" figures link to the Users list, where the new column is.

**Tests**
- Integration: `examsTaken` counts distinct exams, ignores in-progress attempts, and respects an instructor's reach. `/users/:id/attempts` returns 404 for a student outside the instructor's groups.
- RBAC matrix rows for the new route.
- e2e: a student takes two exams → the Users list shows 2 → the user page lists both with scores; a click opens the submission.

---

## Fix 2 · Materials page per category

### Schema (one migration)

`Material` today belongs to an exam. Let it belong to an exam **or** a category:

```prisma
model Material {
  id         String    @id @default(uuid()) @db.Uuid
  examId     String?   @db.Uuid
  exam       Exam?     @relation(fields: [examId], references: [id], onDelete: Cascade)
  categoryId String?   @db.Uuid
  category   Category? @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  title      String
  url        String
  position   Int       @default(0)

  @@index([categoryId])
}
```

At the end of the migration, by hand: `CHECK ((("examId" IS NULL) <> ("categoryId" IS NULL)))`. Existing rows all have an `examId`, so they stay valid.

### Backend

| Route | Access | Does |
|---|---|---|
| `GET /api/catalog/categories/:id/materials` | Super admin, or any instructor grant on that category | List the links |
| `POST /api/catalog/categories/:id/materials` | `EXAM_EDIT` on the category | Add a link (title ≤ 200, `https://` only, as today) |
| `PATCH /api/materials/:id`, `DELETE /api/materials/:id` (existing) | Scope now resolves from the exam **or** the category | Edit, reorder, remove |
| `GET /api/student/materials` (new) | Student | Links grouped by category, for categories of **published** exams assigned to the student. Today's per-exam links included, under their exam. |

Adding, editing and removing are audited, as exam materials are today.

### Frontend

| Where | Change |
|---|---|
| New staff page **Materials** (`/materials`, menu item for super admins and instructors) | One section per category the caller can reach. Each section lists its links; **Add**, **Edit**, **Remove** and reorder when the caller has `EXAM_EDIT` on it. Reuse the form from [ExamMaterials.tsx](../web/src/features/content/ExamMaterials.tsx). |
| **Categories & tags** page | Each category row gets a **Materials** link to its section. |
| New student page **Materials** (`/student/materials`, menu item for students) | One section per category, each link opens in a new tab. Empty state: "No materials yet." |
| Student **exam rules page** (`ExamBrief`) | Under the exam's own links, a line "More for {category}" linking to the student Materials page. |

**Tests**
- Integration: a student sees materials only for categories of published, assigned exams; a draft exam's category is not enough. An instructor without a grant on the category gets 404. The CHECK constraint refuses a row with both or neither id.
- RBAC matrix rows for the new routes.
- e2e: an instructor adds a link to the **Demo** category → a student with a Demo exam sees it on **Materials**; a student without one doesn't.

---

## Definition of done (all four)

- `npm run typecheck && npm run lint && npm run format:check` clean.
- `npm test`, `npm run test:int`, `npm run test:web` and `npm run e2e` pass; coverage gates hold.
- [API.md](API.md) and [TEST_PLAN.md](TEST_PLAN.md) updated; the "How to use" guide updated for the new **Materials** pages and the **Exam history** card.
- Tried by hand on staging with the four sample users.

---

## Release

Two migrations ship with this release, both additive or relaxing, so the previous release still runs on the new schema:

| Migration | Does | Old code on the new schema |
|---|---|---|
| `20261117120000_optional_picture_descriptions` | Drops the three "picture needs alt text" CHECK constraints | Works (it still asks for descriptions itself) |
| `20261117130000_category_materials` | `Material.examId` nullable, new `categoryId` + index + FK, one-owner CHECK | Works (it reads materials by exam only; category links are ignored) |

So a rollback is a code rollback only; restoring the backup is needed only if the data itself went wrong.

### Steps

1. **Merge.** `feat/tag-bundles-results` into `main` first, then `feat/four-fixes` (one pull request; CI runs typecheck, lint, format, unit, integration with coverage, web and e2e).
2. **Tag.** `git tag v<next>` on `main` after the merge.
3. **Staging.** Follow [DEPLOY.md §5](DEPLOY.md): `ops/backup.sh`, check out the tag, `docker compose up -d --build`. Confirm `docker compose ps -a` shows `migrate` exited (0) and `curl -fsS https://$DOMAIN/api/health/ready`.
4. **Check on staging** with the four sample users (the "How to use" guide), plus TEST_PLAN §5.5a:
   - a picture saved without a description;
   - My exams picks up a new assignment without a reload;
   - Exams taken and Exam history for a student who submitted two exams;
   - a category link on **Materials** visible to the student, and Add hidden for an instructor without edit rights.
5. **Restore test** on the pre-upgrade backup: `ops/restore-test.sh …` must end with `RESTORE TEST PASSED`.
6. **Production**, outside exam windows (no exam open on the **Who and when** tabs): the same commands as step 3, then the same checks with a test student.
7. **After.** Read `docker compose logs app` for errors for the first hour; tell instructors about the **Materials** page and the **Exam history** card.

**Rollback:** check out the previous tag and `docker compose up -d --build`. No down-migration is needed (see the table above).

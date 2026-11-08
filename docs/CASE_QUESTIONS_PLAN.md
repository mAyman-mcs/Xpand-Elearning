# Plan: use-case exams (cases with picture options and follow-up questions)

The training use cases ("Operating System Fundamentals", "Ethical Hacking Assessment") are not a list of separate questions. Each one is:

```
Exam intro          "The Story So Far" + instructions          (once per exam)
└─ Case Q1..Q6       label (KNOWLEDGE / DESIGN / FILL IN / TROUBLESHOOT), title,
   │                 Situation text, optional hint, optional picture
   ├─ Main question  one MCQ: options are text (+ grey sub-line) OR pictures (2×2 diagram grid)
   └─ Follow-ups     1–3 written answers on the same case ("What chmod command…?", "What is wrong with Option A…?")
```

This builds on [EXAM_TYPES_PLAN.md](EXAM_TYPES_PLAN.md): a use case is an `MCQ_ESSAY` exam with `MANUAL_APPROVAL` scoring. The MCQ part is auto-scored on submit, the written answers are graded by staff, and the grade/approve/reopen flow stays as built. All rules in [BACKEND_PLAN.md §2 and §8](BACKEND_PLAN.md) still apply (thin routes, pure rules, audit in the same transaction, RBAC matrix rows for every new route).

## Status (2026-11-08, branch `feat/exam-types`)

Built with the defaults in §1. Where the build differs from the text below:

| Planned | Built | Why |
|---|---|---|
| `QuestionCase.position` and `Question.positionInCase` | One exam-wide question order (`Question.position`); a case's questions are kept **consecutive**, and a case sits where its first question is | Reordering, block shuffling and "no going back" all stay index-based; no second ordering to keep in sync |
| Pictures in a Docker volume (NEXT_PLAN E19), re-encoded with `sharp` | Stored in Postgres (`Upload.data`, ≤ 2 MB, CHECK constraint). A dependency-free sanitizer (`modules/uploads/image.ts`) reads the type from the bytes and rewrites PNG/JPEG/WebP without metadata or trailing bytes | Nightly `pg_dump` backs them up with no ops change. `sharp` is native and the Docker image drops optional packages, which would break it |
| C5: `questionsPerAttempt` counts cases | Not needed yet | Publishing still requires it to be empty until question pools arrive |
| C16: warning when a case's first question isn't a choice question | Not built | Only errors exist in the publish check; no warnings channel |
| C13: right-click blocked on pictures | Built, plus no drag and no referrer | |
| The two PDFs' diagrams as pictures | `npm run seed-usecases -w server` loads both use cases with the diagrams written as text options | No picture files to load; trainers can upload them in the editor |

**Done:** §2 (migration `use_case_questions` with CHECK constraints), §3.1–3.5, §4, §5 (unit tests, `cases.int.test.ts`, RBAC matrix rows, `e2e/use-case.spec.ts` on a phone-sized screen with accessibility checks), §6, and §7's fixes in the seed script (explanations are staff-only, hints off).

**Still open:** loading the real diagram pictures, and the content owner fixing §7 in the source PDFs.

---

## What the platform has today vs. what the use cases need

| Need (from the PDFs) | Today | Gap |
|---|---|---|
| Story + instructions before the exam | Nothing on `Exam` | **Exam intro** text, shown on the exam brief page and in the session |
| A "Situation" shared by an MCQ and its follow-ups | Every question stands alone | **Case** (question group) |
| Label chip (KNOWLEDGE, DESIGN…) and a hint | None | Fields on the case |
| Options that are pictures (boot order, attack surface, permission tables) | Options are text only | **Option image** |
| Grey line under each option text | One `text` field | **Option detail** line |
| Pictures stored on our server | `imageUrl` must be an outside `https:` link | **Image upload** (EXAM-8, pulled forward from M2) |
| Follow-ups that say "Option A" | Options are shuffled per student, so "A" differs between students | **Fixed option order + letters** for cases |
| Short one-line answers ("Name one web server") and longer ones | One 10,000-char essay box | **Answer size** (short / long) |
| Grader sees the MCQ choice next to the follow-ups | Grade page lists questions one by one | Grade page **grouped by case** |
| Load the use cases without retyping | JSON import of plain questions | Import of cases + images |

---

## 1. Decisions to confirm

| # | Question | Recommended default | Why |
|---|---|---|---|
| C1 | How are follow-ups tied to the MCQ? | A **Case** holds an ordered list of normal questions (one choice question + ESSAY questions). No "parent question". | Reuses every existing question type, answer and grading path. A case with one question is just a question. |
| C2 | Can an exam mix cases and loose questions? | **Yes.** Loose questions keep working; an exam with no cases behaves exactly as today. | No migration of existing exams |
| C3 | Shuffling | `shuffleQuestions` shuffles **cases as whole blocks**; questions inside a case keep their order (MCQ first, then follow-ups). | Follow-ups make no sense before the MCQ |
| C4 | Option shuffling inside cases | **Off for questions inside a case**, and option letters **A, B, C, D** are shown in the session and on the grade page. Loose questions keep `shuffleOptions`. | Follow-ups and picture captions refer to "Option A". Letters must mean the same for every student and the grader. |
| C5 | `questionsPerAttempt` | Counts **cases** (a loose question counts as one). | Picking half a case breaks it |
| C6 | Option pictures | Each option has text, image, or both (at least one). An image needs **alt text** (required, max 300). Layout: if any option in the question has an image → **2×2 grid** (1 column on phones), else the current list. | Matches the PDFs; alt text keeps it usable with a screen reader |
| C7 | Where pictures live | **Upload** (png, jpeg, webp, max 2 MB, type checked from the file bytes, re-encoded to strip metadata) into the `uploads` volume per NEXT_PLAN E19. Outside `https:` links stay allowed for old questions but the editor offers upload first. | Outside links leak students' IPs (S1.6) and anyone can open them without logging in |
| C8 | Who can load an exam picture | Staff with `EXAM_EDIT`/review scope on that exam; a student **only while they have an attempt on that exam**, and later only if results with questions are shown (B11). Response `Cache-Control: private, no-store`. | A picture option can be the answer key; it must not be fetchable before the exam |
| C9 | Hint | Optional per case. Exam setting **"Show hints"**, default **off** for scored exams. | The PDF hints nearly give the answer (e.g. "skip the first '-'…"). Trainers decide. |
| C10 | Written answer size | Per ESSAY question: `SHORT` (one line, max 300 chars) or `LONG` (textarea, max 10,000, as today). | "What chmod command…" needs one line; a big box invites padding |
| C11 | Points | Default: case MCQ **2 points**, each follow-up **1 point**, editable per question. Case total shown in the editor. | Keeps a 6-case use case around 24 points |
| C12 | Session layout | **One case per screen**: situation and picture on top, MCQ, then follow-ups. The question navigator shows Q1…Q6 with a dot per sub-answer. "Back navigation off" applies per case. | Mirrors one PDF page per case; the student never loses the situation |
| C13 | Zooming pictures | Tap/click opens an **in-page** viewer (not the browser's fullscreen API, so it is not a fullscreen-exit strike). Right-click / drag on images blocked like copy. | Diagrams are unreadable at phone width otherwise |
| C14 | Model answers | Each follow-up's `guidance` holds the model answer (staff only, as built). The MCQ gets an optional **per-option explanation**, staff only (later shown to students with B11). | The grey "why it's wrong" lines in the PDFs are explanations, not option text (see §7) |
| C15 | Locking after attempts | Same as today: once an attempt exists, only wording changes (case title, situation, hint, option text/detail, alt text, guidance). Replacing a picture counts as wording **only if** it is the same option; adding/removing cases or questions in a case → `409 CONFLICT`. | Same rule as E1 |
| C16 | Publish checks | A case must have **at least one question**; a case's first question must be a choice question if the case has follow-ups that reference options (warning, not error). Every image option needs alt text. | Catches broken cases before students see them |

---

## 2. Schema changes (one migration)

```prisma
model Exam {
  // …
  intro      String?  // "The Story So Far" + instructions, plain text with line breaks, max 5,000
  showHints  Boolean  @default(false)  // C9
  cases      QuestionCase[]
}

model QuestionCase {
  id        String   @id @default(uuid()) @db.Uuid
  examId    String   @db.Uuid
  exam      Exam     @relation(fields: [examId], references: [id], onDelete: Cascade)
  position  Int
  label     String?  // short chip: KNOWLEDGE, DESIGN, FILL IN, TROUBLESHOOT (free text, max 20)
  title     String   // "Linux File Permissions"
  situation String   // max 5,000
  hint      String?  // max 1,000; sent to students only when exam.showHints
  imageId   String?  @db.Uuid
  image     Upload?  @relation(fields: [imageId], references: [id])
  questions Question[]

  @@index([examId])
}

enum AnswerSize { SHORT LONG }

model Question {
  // …
  caseId          String?      @db.Uuid
  case            QuestionCase? @relation(fields: [caseId], references: [id], onDelete: Cascade)
  positionInCase  Int?         // set iff caseId is set (CHECK)
  imageId         String?      @db.Uuid   // uploaded picture; imageUrl stays for outside links
  imageAlt        String?
  answerSize      AnswerSize   @default(LONG)  // ESSAY only
}

model Option {
  // …
  text        String?   // now optional: text OR image required (CHECK)
  detail      String?   // grey sub-line shown to students, max 300
  imageId     String?   @db.Uuid
  imageAlt    String?   // required when imageId is set (CHECK)
  explanation String?   // staff only, never serialized to students (C14)
}

model Upload {
  id          String   @id @default(uuid()) @db.Uuid
  examId      String?  @db.Uuid    // owning exam, drives who may read it (C8)
  mime        String               // image/png | image/jpeg | image/webp
  bytes       Int
  sha256      String
  width       Int
  height      Int
  createdById String   @db.Uuid
  createdAt   DateTime @default(now())
  @@index([examId])
}
```

SQL migration notes:
- CHECK: `(caseId IS NULL) = (positionInCase IS NULL)` on `Question`.
- CHECK: `text IS NOT NULL OR "imageId" IS NOT NULL` and `"imageId" IS NULL OR "imageAlt" IS NOT NULL` on `Option`.
- Existing rows: no cases, `answerSize = LONG`, option `text` already set. Nothing changes for current exams.
- The file itself lives at `uploads/<id>` in the Docker volume; `ops/backup.sh` and `restore-test.sh` include the volume.

`Attempt.questionOrder` stays a flat list of question ids, built from the shuffled case order (C3). The case boundaries are re-derived from `Question.caseId` when the view is built, so no new attempt column is needed.

---

## 3. Backend

### 3.1 Uploads module (`server/src/modules/uploads/`)
- `POST /api/uploads?examId=…` (`EXAM_EDIT` on that exam): raw body (not JSON; mount before `express.json`), max 2 MB. Detect type from magic bytes, decode and re-encode with `sharp` (strips EXIF), cap at 2000 px on the long side, store, return `{ id, url: "/api/uploads/<id>", width, height }`. Audit `uploads.created`.
- `GET /api/uploads/:id`: the C8 rule as a pure function `canReadUpload(principal, upload, activeAttemptExamIds)` with unit tests. `Content-Type` from the row, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- CSP: keep `img-src 'self' data: https:` until outside links are retired; then tighten to `'self' data:`.
- RBAC matrix rows for both routes; the route-coverage test will force this.

### 3.2 Cases in the catalog
- `POST/PATCH/DELETE /api/catalog/exams/:id/cases[/:caseId]`, `PUT …/cases/order` (`EXAM_EDIT`).
- Questions: create/patch accept `caseId`, `positionInCase`, `imageId`, `imageAlt`, `answerSize`; options accept `text?`, `detail`, `imageId`, `imageAlt`, `explanation`.
- `GET …/questions` returns `{ cases: [{ …case, questions: [...] }], questions: [...loose] }` in position order, so the editor shows the real structure.
- Lock rules (C15) extend the existing locked-content check in `content.service.ts`.
- Publish check (C16) extends the existing publish problems list.
- Duplicate exam copies cases, and **re-points** (does not copy) uploads, since uploads are immutable.

### 3.3 Session (`attempts/service.ts`)
- `deliveryOrder`: group questions by case → shuffle blocks (C3) → keep inner order → no option shuffle for case questions (C4) → apply `questionsPerAttempt` to blocks (C5). Unit tests in `rules.test.ts` for each.
- `studentView` adds `intro`, and `cases: [{ id, label, title, situation, hint (only if showHints), imageUrl, questionIds }]`; questions add `caseId`, `answerSize`, `image`; options add `letter`, `detail`, `image`. It never sends `explanation`, `guidance` or `isCorrect`: extend the existing leak test to cover the new fields.
- Save answer: SHORT answers capped at 300 chars (400 `VALIDATION_FAILED`).

### 3.4 Grading
- `GET /api/grading/attempts/:id` returns answers grouped by case, each MCQ with the student's chosen letter, the correct letter and the per-option explanations; each follow-up with its guidance. No new write routes: points, overrides, approve and reopen work as built.

### 3.5 Import
- Extend the question import JSON with a `cases` array (format in §6). Images are referenced by upload id, so the flow is: upload pictures → import JSON. Dry run reports missing upload ids and missing alt text.
- A script `server/scripts/seed-usecases.ts` loads the two PDFs' content as demo exams (pictures from a local folder), so trainers can try them right away.

---

## 4. Frontend

| Screen | Changes |
|---|---|
| **Exam form** (`ExamForm.tsx`) | "Introduction" textarea; "Show hints to students" switch |
| **Questions page** (`ExamQuestions.tsx`) | Cases as cards (label chip, title, number of questions, total points) with drag/keyboard reorder; "Add case"; loose questions still listed; "Move into case" |
| **Case editor** (new `CaseEditor.tsx`) | Label (suggestions: KNOWLEDGE, FILL IN, DESIGN, TROUBLESHOOT), title, situation, hint, picture. Below: its questions using the existing `QuestionEditor`, plus "Add follow-up (written)" which creates an ESSAY with `answerSize` |
| **Question editor** (`QuestionEditor.tsx`) | Picture upload (drop or pick a file, preview, alt text) for the question and each option; option "detail" and staff-only "explanation" fields; for ESSAY: short/long; live preview shows the 2×2 grid when options have pictures |
| **Exam brief** (`ExamBrief.tsx`) | Shows `intro` before Start |
| **Exam session** (`ExamSession.tsx`) | One case per screen (C12): label chip + title, situation box, hint (if sent), picture; MCQ with letters A–D (grid for pictures); follow-ups below with one-line or textarea inputs. Navigator groups by case. Pictures load through `/api/uploads` with `referrerPolicy="no-referrer"`, `draggable={false}`, context menu blocked. In-page zoom viewer (C13). Autosave per answer stays as is (`saver.ts`). |
| **Grade attempt** (`GradeAttempt.tsx`) | Grouped by case: situation (collapsible), the student's choice vs. correct choice with the pictures, then each follow-up with the student's text, model answer, points (0.5 steps) and feedback |
| **Done page / dashboard** | No change (scores already wait for approval) |

Accessibility and phone width (as in A7): picture options are radio/checkbox inputs whose label is the letter + alt text; grid collapses to one column under 640 px; the zoom viewer traps focus and closes with Esc; no horizontal scroll.

---

## 5. Tests

- **Unit:** `deliveryOrder` with cases (block shuffle, fixed inner order, no option shuffle, `questionsPerAttempt` by case); `canReadUpload`; option/case validation (text-or-image, alt required, SHORT length).
- **Integration:** upload type sniffing (a `.png` that is really HTML is refused), metadata stripped, read rules for staff / student with attempt / student without attempt / other exam; case CRUD + lock rules; publish checks; `studentView` never contains `explanation`, `guidance`, `isCorrect`; grading view grouped by case; RBAC matrix rows.
- **E2E (`e2e/use-case.spec.ts`):** trainer builds a 2-case exam with picture options and a follow-up → student takes it on a phone-sized viewport (zooms a picture, answers the MCQ by picture, writes short and long answers) → grader sees the case grouping, gives points, approves → score appears. Plus the a11y spec over the case screen.

---

## 6. Import format (one case)

```json
{
  "intro": "TechBridge's entire infrastructure stack is built…",
  "cases": [
    {
      "label": "DESIGN",
      "title": "Boot Sequence",
      "situation": "A junior IT staff member at TechBridge asks Ahmed: 'When I press the power button…'",
      "hint": "The firmware must initialize hardware before any software can run…",
      "questions": [
        {
          "type": "SINGLE_CHOICE", "points": 2,
          "text": "Which sequence correctly represents the order of events when a server boots up?",
          "options": [
            { "imageId": "<upload id>", "imageAlt": "Power On, BIOS/UEFI, Bootloader, Kernel Loading, OS Login", "isCorrect": true,
              "explanation": "BIOS initialises hardware first, then hands off to the bootloader" },
            { "imageId": "<upload id>", "imageAlt": "Power On, Bootloader, BIOS/UEFI, Kernel Loading, OS Login", "isCorrect": false }
          ]
        },
        { "type": "ESSAY", "answerSize": "LONG", "points": 1,
          "text": "What is the role of BIOS/UEFI in the boot process?",
          "guidance": "Initialises and tests hardware (POST), then finds and starts the bootloader." },
        { "type": "ESSAY", "answerSize": "LONG", "points": 1,
          "text": "What is Secure Boot and why does it improve server security?",
          "guidance": "UEFI only runs bootloaders/kernels signed with trusted keys; blocks bootkits/rootkits loading before the OS." }
      ]
    }
  ]
}
```

---

## 7. Content fixes needed before loading the two PDFs

The platform can't fix these; the content author should, or the answers leak:

| Where | Problem | Fix |
|---|---|---|
| Ethical Hacking Q1 picture A | Caption "Correct order — reconnaissance first, reporting last" | Re-export pictures **without captions**; move captions to `explanation` |
| OS Q6 picture B | Title "Option B — Least Privilege **(Correct)**"; other titles also name the flaw ("Guest User Overprivileged") | Title just "Option A/B/C/D" |
| All picture options (both PDFs) | Captions under each diagram explain why it is right or wrong | Remove from picture; put in `explanation` |
| Text options (all MCQs) | The grey line explains each wrong answer (e.g. OS Q2 C: "contradicts the string"; EH Q2 D: "OpenSSH 7.4 is patched") | Use `detail` only for neutral descriptions (e.g. OS Q1 "Consumer desktop OS"), move judgements to `explanation` |
| Hints | Several give the answer away | Keep for practice runs; leave **"Show hints" off** for scored runs (C9) |
| One letter per picture | Pictures have "A/B/C/D" baked in | Fine with C4 (fixed order), but drop the baked letter so the platform's letter is the only one |
| Headers | "UseCase4 - Operating System" says "Use case 5 of 5"; "UseCase5 - Ethical Hacking" says "4 of 5" and uses a different brand line | Pick one numbering for the exam titles/codes |
| Ethical Hacking Q3, last follow-up | Prompt is split over a page break ("…and what is the most / dangerous port it exposes?") | Join into one question text |

---

## 8. Build order and estimate

| # | Work | Estimate |
|---|---|---|
| 1 | Uploads module (store, re-encode, read rule, backup volume, CSP), tests | 2 days |
| 2 | Migration: cases, option images/detail/explanation, answer size, exam intro/hints | 0.5 day |
| 3 | Case CRUD, lock rules, publish checks, duplicate, import, tests | 2 days |
| 4 | Delivery order + student view + SHORT answers, leak tests | 1.5 days |
| 5 | Grading view grouped by case | 0.5 day |
| 6 | Editor: upload widget, case editor, option pictures, preview | 3 days |
| 7 | Session: case screen, picture grid, zoom viewer, navigator, brief intro | 2.5 days |
| 8 | Grade page grouped by case | 1 day |
| 9 | `seed-usecases.ts` with both PDFs, e2e + a11y specs, docs (`API.md`, `FRONTEND_GUIDE.md`) | 1.5 days |

**About 6.5 days backend and 8 days frontend**: roughly 2 weeks for one backend and one frontend developer working in parallel. Steps 1–2 unblock everything else; step 9's seed script can start as soon as step 3 lands.

## 9. Out of scope (later)

- Students seeing explanations, model answers and per-question points after release (B11)
- "Drag into order" questions (an alternative to the boot-sequence pictures) and table/matrix questions (an alternative to the permission tables)
- A follow-up whose text changes based on the option the student picked
- Printing a use case back to PDF for offline sessions

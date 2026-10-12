# Frontend guide: M1 and M2

This is for the developer building the React app for the next phases of the Xpand CS Academy portal. It covers what already exists, the rules every screen must follow, and the screens to build, with acceptance criteria.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first for the data model and the access-control rules. The legacy Apps Script portal ([../frontend.html](../frontend.html)) shows the current look (teal palette, rounded cards) and the features users already know. Reuse its visual style, **not its code**: it trusts the browser for everything.

---

## 1. Getting started

```sh
cp .env.example .env    # DATABASE_URL=postgresql://xpand:xpand-dev@localhost:5433/xpand, COOKIE_SECURE=false
docker compose -f docker-compose.dev.yml up -d
npm install
npm run db:migrate -w server
npm run create-super-admin -w server -- --username admin --name "Dev Admin"
npm run dev:server     # API on :8080
npm run dev:web        # React on http://localhost:5173 (proxies /api to :8080)
```

To create test students, see "Importing students" in the [README](../README.md).

Stack: React 19, TypeScript (strict), Vite, Tailwind 4. `react-router-dom` is installed but not used yet; introduce it with the first M1 screens.

## 2. What exists today (M0)

| File | What it does |
|---|---|
| [web/src/api.ts](../web/src/api.ts) | `call()` wraps `fetch`: same-origin cookies, JSON bodies, and it throws `ApiError(status, code, message)` on any non-2xx response. Add every new endpoint to the `api` object here. |
| [web/src/auth.tsx](../web/src/auth.tsx) | `AuthProvider` / `useAuth()` → `{ user, loading, setUser, logout }`. Loads `/api/auth/me` once on start. |
| [web/src/main.tsx](../web/src/main.tsx) | Gate: loading → `Login` → `ChangePassword` (while `mustChangePassword`) → `Home`. |
| `web/src/pages/` | `Login`, `ChangePassword`, and a placeholder `Home`. |

### Available endpoints

| Method | Path | Body | Success |
|---|---|---|---|
| POST | `/api/auth/login` | `{ username, password }` | `{ user }` and sets the session cookie |
| POST | `/api/auth/logout` | `{}` | 204 |
| GET | `/api/auth/me` | | `{ user }` |
| POST | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `{ user }` |
| GET | `/api/health/live`, `/api/health/ready` | | `{ ok: true }` |

`user` = `{ id, username, fullName, email, mobile, role: "SUPER_ADMIN" | "INSTRUCTOR" | "STUDENT", mustChangePassword }`

### Error codes

Every error body is `{ error: CODE, message?, details? }`. The full list lives in `server/src/core/errors.ts`.

| HTTP | Code | What the UI should do |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed request (a bug); show a generic error |
| 400 | `VALIDATION_FAILED` | Input rejected; `details` is `[{ path, message }]`, so show messages next to the fields |
| 400 | `WRONG_CURRENT_PASSWORD` / `WEAK_PASSWORD` | Show inline; `WEAK_PASSWORD` comes with a readable `message` |
| 401 | `UNAUTHENTICATED` | **Global:** the session expired or was revoked → `setUser(null)`, which shows Login. Add a one-line notice: "Your session ended, please sign in again." |
| 401 | `INVALID_CREDENTIALS` | Login form: "Invalid username or password." |
| 403 | `PASSWORD_CHANGE_REQUIRED` | **Global:** reload `/me` so the gate shows ChangePassword |
| 403 | `FORBIDDEN` | "You don't have access to this." Never retry. |
| 404 | `NOT_FOUND` | Not-found state |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | A bug: a write was sent without a JSON body |
| 404 | `NOT_FOUND` (staff routes) | Also returned for resources outside your scope, so their existence is not revealed |
| 409 | `CONFLICT` | Duplicate or conflicting change (e.g. assigning an exam twice); show `message` |
| 413 | `PAYLOAD_TOO_LARGE` | Request body over 100 KB |
| 423 | `ACCOUNT_LOCKED` | Login form; `details.retryAfter` says when the lock ends |
| 429 | `TOO_MANY_ATTEMPTS` | Login form: "Too many attempts, try later." |
| 500 | `INTERNAL_ERROR` | Generic error with a retry button |

**First M1 task:** handle the two **global** cases once, centrally in `api.ts` and `auth.tsx` (for example an `onUnauthenticated` callback), instead of in each screen.

### All other endpoints

The complete, current API (staff, catalog, assignment and student endpoints, by role, with request and response shapes) is in **[API.md](API.md)**. Where §4 below shows a **DRAFT** shape for a feature that API.md documents, API.md wins.

## 3. Rules every screen must follow

These rules are why the platform is being rebuilt. A PR that breaks one is not done.

1. **The server is the only authority.** Hiding a button is a convenience, not security. Don't compute permissions, scores, exam status, remaining time or "already submitted" in the browser; display what the API returns.
2. **No state in `localStorage` or `sessionStorage`** apart from harmless UI preferences (for example a collapsed sidebar). The legacy app kept sessions, locks and overrides there, and any student could edit them.
3. **No tokens in JavaScript.** The session is an `HttpOnly` cookie the browser sends automatically. Never read, store or forward it.
4. **No raw HTML.** Never use `dangerouslySetInnerHTML` or `innerHTML`, and never build HTML strings (the legacy app did, and that made it open to cross-site scripting). Render user-supplied text, such as names and question text, as normal React text.
5. **Content Security Policy** (sent by the server in production): `script-src 'self'`.
   - No CDN `<script>` tags and no inline scripts. Install libraries from npm and let Vite bundle them; for example `html2canvas` for the scorecard must come from npm.
   - Images may come from `https:` URLs.
   - iframes may only load `docs.google.com` and `drive.google.com` (training material viewer).
   - Test production behaviour with the Docker build, because the Vite dev server sends no CSP.
6. **Every write is JSON.** Always send a body, even `{}`, with `Content-Type: application/json` (`call()` already does this).
7. **Every data view handles four states:** loading, empty, error, and data.
8. **Layout and accessibility:**
   - Usable at 400 px wide (students will open the dashboard on phones; exams run on classroom PCs).
   - Every form field has a label, and everything works with the keyboard.
   - Colour is never the only signal (status badges also have text).
9. **Time:**
   - The API sends ISO 8601 UTC timestamps. Display them in **Africa/Cairo** with `Intl.DateTimeFormat`.
   - Countdowns are computed from server timestamps. Correct for clock skew using the server time each API response returns (planned for M1).

## 4. Screens to build

Feature IDs (for example `ASN-3`) refer to the project feature list; the milestone is in each heading. In the API notes, **DRAFT** means the backend hasn't built the endpoint yet. Treat names and shapes as proposals, agree them with the backend developer before coding against them, and mock them until then.

### 4.1 App shell and navigation (M1)

- Routes set up with react-router. The sidebar shows only what the role allows.
  - Students: Dashboard, Program Rules.
  - Instructors and the super admin get staff sections (§4.4).
- The header shows the name, role and group's intake date, plus Logout.
- Instructors see only the menu entries their grants allow. The data for that comes from `GET /api/me/permissions` → `{ role, grants: [{ permissions, allExams, examIds, categoryIds, allGroups, groupIds, expiresAt }] }` (active grants only).

*Done when:* deep links work after a reload; a student who types a staff URL gets the "no access" page (and the API also returns 403); a session that expires while the app is open returns to Login with a notice.

### 4.2 Student dashboard (M1: STU-1, STU-2, STU-3)

Matches the legacy dashboard, with real data:

- Summary cards: ranking, total %, completed count, warnings (the card turns red when warnings > 0).
- One card per assigned exam. **Only exams assigned to this student appear.** Status comes from the API:

| Status | Badge | Card content | Action |
|---|---|---|---|
| `SCHEDULED` | Scheduled | "Opens on …" plus a live countdown | none |
| `OPEN` | Available | "Closes at …" if there is a closing time | **Start** (→ §4.3) |
| `IN_PROGRESS` | In progress | Time left | **Resume** on the device that started it; on any other device the server refuses (`ATTEMPT_IN_PROGRESS_ELSEWHERE`): show "This exam is in progress on another device" |
| `SUBMITTED` | Submitted | Submission time; score only if results are released, otherwise "Pending" | none |
| `CLOSED` | Closed | "Locked by instructor" | none |
| `MISSED` | Missed | The window passed without an attempt | none |
| `EXTERNAL` | (CTF) | "Completed in the classroom", plus the score when entered | none |

- Training material: "View" opens a modal with the Google Docs viewer iframe; "Download" opens the file URL.
- **DRAFT** `GET /api/student/dashboard` → `{ summary: { rank, cohortSize, totalPercent, completed, warnings }, exams: [{ examId, title, status, opensAt, closesAt, score, materials: [{ title, url }] }] }`.

*Done when:* nothing about status is computed in the browser; when a countdown reaches zero the app refetches instead of flipping the card to Open by itself.

### 4.3 Locked-down exam session (M1: SESS-1 to SESS-16)

The most important screen. The server enforces the attempt; the browser **detects and reports**, and shows what the server decides.

**Flow**
1. **Pre-check page:** exam name, duration, number of questions, strike limit, and the anti-cheat rules (from the legacy instructions screen). A checkbox "I agree" enables Start.
2. *(M2)* An access-code (proctor PIN) field, if the exam requires one.
3. **Start:** call **DRAFT** `POST /api/attempts { examId }` → `{ attemptId, deadlineAt, serverNow, strikeLimit, strikes, questions: [{ id, type, text, imageUrl, options: [{ id, text }] }], answers }`.
   - Questions and options arrive already shuffled. **The response never says which answer is correct;** if you ever see that field, report it as a security bug.
   - Errors to handle: `EXAM_NOT_OPEN`, `ALREADY_SUBMITTED`, `ATTEMPT_IN_PROGRESS_ELSEWHERE`.
4. **Fullscreen:** request it from the Start click (browsers require a user gesture). If it's refused, show a blocking screen with a "Enter fullscreen" button. No questions are shown outside fullscreen.
5. **Question view:**
   - One question per page with a numbered navigator (unanswered and flagged states).
   - If the exam disallows going back, hide "Previous" and the navigator jumps.
   - A diagonal, semi-transparent watermark with the student's name and username covers the question area (SESS-17, can follow in M2).
6. **Answers are saved on every change:** **DRAFT** `PUT /api/attempts/:id/answers/:questionId { selectedOptionIds }`.
   - Show a small "Saved" or "Saving…" indicator.
   - If a save fails, retry with backoff and show a visible "Connection problem: your last answer is not saved yet" banner.
   - Never keep answers only in the browser.
7. **Timer:** `remaining = deadlineAt − (Date.now() + (serverNow − clientTimeAtResponse))`. At 0, stop input, call submit, and let the server have the final word.
8. **Submit:** a confirmation dialog listing unanswered questions, then **DRAFT** `POST /api/attempts/:id/submit`.
   - Then `location.replace()` to the "Submitted" page, so Back doesn't return to the questions.
   - Exit fullscreen there.
9. **Submitted page:** "Your answers were submitted at …". No score unless the results are released.

**Detection: report each event to DRAFT `POST /api/attempts/:id/events { type, detail }`**

| Event | Type | How to detect |
|---|---|---|
| Left fullscreen | `FULLSCREEN_EXIT` | `fullscreenchange` with `document.fullscreenElement === null` |
| Switched tab or minimised | `TAB_HIDDEN` | `visibilitychange` → `hidden` |
| Window lost focus (another app, split screen) | `WINDOW_BLUR` | `blur` on `window` (debounce about 300 ms) |
| Window made much smaller | `RESIZE` | `resize`: width or height below about 85% of the screen |
| Copy, cut, paste | `CLIPBOARD` | `copy` / `cut` / `paste` → `preventDefault()` and report |
| Right-click | `CONTEXT_MENU` | `contextmenu` → `preventDefault()` and report |
| Blocked shortcut | `BLOCKED_SHORTCUT` | `keydown`: Ctrl/Cmd + C, V, X, A, P, S, U, F12, Ctrl+Shift+I/J/C → `preventDefault()` and report |
| Print | `BLOCKED_SHORTCUT` | `beforeprint`, plus a print stylesheet that hides the questions |

- The server replies `{ strikes, strikeLimit, action: "WARN" | "AUTO_SUBMITTED" }`. Show a blocking warning overlay ("Warning 2 of 3: leaving the exam window is not allowed"), which must be acknowledged, then require fullscreen again.
- On `AUTO_SUBMITTED`, go to the Submitted page with the reason.
- Queue events that fail to send and retry them; don't drop them.
- **Heartbeat:** **DRAFT** `POST /api/attempts/:id/heartbeat` every 10 s. If the reply says the attempt is no longer active (submitted or auto-submitted), stop immediately and show why. There is no "allow resume": an attempt never moves to another device, so warn the student before Logout during an exam.
- **Reloading the page** during an attempt must resume the same attempt (if the server allows) with the remaining time, not start a new one.
- Disable text selection in the question area with CSS (`user-select: none`), but keep it in text inputs.
- **Accessibility:** the anti-cheat measures must not block keyboard navigation (Tab, Enter, Space, arrows).

*Done when:*
- Every scenario in the tester's session checklist ([TEST_PLAN.md](TEST_PLAN.md), §5.4) behaves as described.
- No answer, timer value or lock state is kept anywhere except on the server.
- The browser Back button after submit never shows a question.

> Browsers can't stop a phone or a second computer, and some signals have false positives (for example an OS notification can cause a blur). That's why the server decides how much each signal counts and the proctor sees them all. The frontend reports faithfully and doesn't decide.

### 4.4 Staff screens (M1)

Shared pattern:
- A list page with search, filters and pagination.
- A detail or edit page.
- A confirmation dialog for destructive actions, with a required **reason** field where the API asks for one (it goes into the audit log).

| Screen | Who | Content |
|---|---|---|
| **Users** | Super admin | List and search; create, edit, deactivate; reset password (shows a one-time temporary password); CSV import (upload → shows row errors → shows the credentials once) |
| **Groups** | Super admin | Create a group with an intake date; manage members; set a per-member join date for late joiners |
| **Instructors and grants** | Super admin | Make a user an instructor. **Grant editor:** permission checkboxes (§4.6), exam picker ("All exams" or a list), group picker ("All groups" or a list), optional expiry. Shows each grant as a readable sentence, e.g. "Can view results and schedule *Cloud Gates* for *Intake July 2026* until 31 Dec 2026". |
| **Exams** | Super admin, or instructors with `EXAM_EDIT` | Settings (duration, pass mark, weight, attempts, shuffle, back navigation, strike limit, fullscreen required, external); question editor (single choice, multiple choice, true/false, image URL, mark correct options); materials |
| **Assign and schedule** | `EXAM_ASSIGN` / `EXAM_SCHEDULE` | Pick the target (users and/or groups, limited to scope). Pick the mode: **Fixed** (open and close date/time), **Relative to join date** (day offset + time + window length), or **Manual**. **Preview table:** for each affected student, show the resolved opening and closing time, so a relative schedule is clear before saving. |
| **Open or close now** | `EXAM_SCHEDULE` | Override for a user or group, with an optional end time and reason; list active overrides with a "remove" action; show the precedence (user > group > schedule) |
| **Results** | `RESULTS_VIEW` | Choose an exam (only exams in scope) → table of students (only groups in scope): status, score, submitted at, violation count; drill down into an attempt (M2) |
| **Audit log** | Super admin (instructors with `AUDIT_VIEW`, scoped) | Filterable list: who, what, when, target |

The backend will provide the list endpoints already filtered to the caller's scope. The UI never filters for security, only for convenience.

### 4.5 M2 screens

- **Live proctor board (PROC-1):**
  - Students currently in an exam: time left, last heartbeat (green if under 20 s ago, amber, red), strikes, latest violation.
  - Actions: force submit, add time.
  - Updates live (the server will push via Server-Sent Events or WebSocket; to be confirmed).
- **Attempt detail (RES-4):** answers, timeline of violations and heartbeats.
- **Void or reopen an attempt (PROC-5)** with a required reason.
- **Release results** per exam (RES-3), and **export CSV** (RES-7).
- **Scorecard** (STU-4):
  - Built from server data only.
  - Exported to PNG with `html2canvas` (installed from npm, not a CDN).
  - Grade bands: under 80 Failed, under 90 Passed, under 95 Very Good, otherwise Excellent.
  - Certificate eligibility comes from the API.
- **Attendance and warnings** (OPS-2, OPS-3); **personal activity history** (STU-6); **calendar of upcoming exams** (ASN-8).
- **Program rules** page, plus a mandatory first-login acceptance (STU-5).

### 4.6 Permission names (for UI labels)

| Permission | Label |
|---|---|
| `EXAM_EDIT` | Edit exams and questions |
| `EXAM_ASSIGN` | Assign exams |
| `EXAM_SCHEDULE` | Schedule and open/close exams |
| `RESULTS_VIEW` | View results |
| `RESULTS_RELEASE` | Publish results to students |
| `PROCTOR` | Proctor live sessions |
| `ATTEMPT_VOID` | Void or reopen attempts |
| `AUDIT_VIEW` | View audit log |

## 5. Definition of done for every PR

- `npm run typecheck` and `npm run build -w web` pass.
- No `dangerouslySetInnerHTML`, no `localStorage` for app state, no CDN scripts.
- Loading, empty and error states exist; it works at 400 px; keyboard reachable.
- Checked once against the production Docker build (CSP active), not only `vite dev`.
- Any new API call is added to `api.ts` with types. Mocks of **DRAFT** endpoints are clearly marked, so they can be swapped out when the real endpoint lands.

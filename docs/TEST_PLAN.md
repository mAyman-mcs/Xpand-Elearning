# Test plan: Xpand CS Academy portal

This is for the tester of the new portal. It lists what to test, how, and what should happen.

- **§4 can be run now.** It covers M0: login, sessions, passwords, admin scripts, security basics.
- **§5 is the checklist for M1 and M2.** Prepare test data and scenarios now, and run each part when that feature is delivered.

Background: [ARCHITECTURE.md](ARCHITECTURE.md) explains the roles, permissions and data model. The old Google Apps Script portal ([../frontend.html](../frontend.html)) is being replaced. Many of its weaknesses (passwords in the page source, admin rights by name, exam locks stored in the browser) are exactly what this plan must prove are gone.

---

## 1. Principles

1. **Always test the server, not only the screen.** Every rule must hold when the request is sent directly (curl, Postman, or "Edit and Resend" in the browser DevTools). A hidden button proves nothing.
2. **Test the boundaries:** one minute before and after an opening time, the 5th and 6th failed login, the last second of an exam.
3. **Every staff action must appear in the audit log** (§3.3).
4. Record the exact time (Africa/Cairo) of each failure; the server logs and the audit log are keyed by time.

## 2. Environments

| Environment | URL | Notes |
|---|---|---|
| Local (developer machine) | `http://localhost:5173` (dev) or `http://localhost:8080` (Docker build) | Setup in the [README](../README.md) |
| Staging | *to be provided* | Should run the same Docker image as production |
| Production (EC2) | *to be provided* | HTTPS only. **Never run destructive tests here.** |

Run browser security checks (headers, CSP) against the **Docker build** or staging; the Vite dev server (`:5173`) doesn't send security headers.

**Browsers:** latest Chrome, Edge and Firefox on Windows (the classroom PCs). Also latest Safari on macOS and Chrome on Android/iOS for the student dashboard. Exams are expected on desktop only; confirm the mobile behaviour with the team before M1.

## 3. Tools and test data

### 3.1 Database access (local and staging only)

```sh
docker compose -f docker-compose.dev.yml exec db psql -U xpand -d xpand    # local
docker compose exec db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"          # staging/EC2
```

The SQL snippets below simulate time passing or admin actions that have no screen yet.

### 3.2 Test accounts

```sh
npm run create-super-admin -w server -- --username qa.admin --name "QA Admin"
```

Then import students from `imports/qa.csv` (`imports/` is ignored by git):

```csv
username,fullName,email,mobile,group,groupIntakeDate,joinDate
qa.stu1,QA Student One,qa1@example.com,+20 100 000 0001,QA-Intake-A,2026-07-05,
qa.stu2,"QA Student, Two",qa2@example.com,,QA-Intake-A,2026-07-05,2026-07-19
qa.stu3,طالب تجريبي,,,QA-Intake-B,2026-08-01,
```

```sh
npm run import-users -w server -- --file ../imports/qa.csv
```

The temporary passwords are in `imports/credentials-*.csv`. Delete that file when you finish.

### 3.3 Reading the audit log

```sql
SELECT a.at, u.username AS actor, a.action, a."entityType", a."entityId", a.detail, a.ip
FROM "AuditLog" a LEFT JOIN "User" u ON u.id = a."actorId"
ORDER BY a.id DESC LIMIT 20;
```

### 3.4 Calling the API directly

```sh
# log in and keep the session cookie in a file
curl -s -c ck.txt -H "Content-Type: application/json" \
  -d '{"username":"qa.stu1","password":"..."}' http://localhost:8080/api/auth/login
# use it
curl -s -b ck.txt http://localhost:8080/api/auth/me
```

---

## 4. M0: test now

Mark each case **Pass / Fail / Blocked** and note the build or commit tested.

### 4.1 Login

| ID | Steps | Expected |
|---|---|---|
| L-01 | Log in as `qa.stu1` with its temporary password | The "Set a new password" page appears (not the dashboard) |
| L-02 | Log in with the username in capitals and with spaces around it (`  QA.STU1 `) | Works: usernames ignore case and surrounding spaces |
| L-03 | Log in with the right password in a different case, or with an extra space | Rejected: passwords are exact |
| L-04 | Wrong password | "Invalid username or password." |
| L-05 | Unknown username | **Exactly** the same message, and the same API response body as L-04 (compare in the Network tab). The app must not reveal which usernames exist. |
| L-06 | Deactivate the user (`UPDATE "User" SET "isActive"=false WHERE username='qa.stu2';`), then log in with the correct password | Same message as L-04. Undo afterwards with `SET "isActive"=true`. |
| L-07 | 5 wrong passwords in a row, then the **correct** password | 6th attempt: "Your account is locked for 15 minutes" (HTTP 423). `SELECT "lockedUntil" FROM "User" WHERE username='qa.stu1';` is about 15 minutes ahead. |
| L-08 | After L-07, end the lock (`UPDATE "User" SET "lockedUntil"=now()-interval '1 minute' WHERE username='qa.stu1';`) and use the correct password | Login works |
| L-09 | 3 wrong passwords, 1 correct (log out), then 4 wrong, then the correct one | Not locked: a successful login resets the failure count |
| L-10 | 21 login requests within 15 minutes from the same machine (any mix of right and wrong) | From the 21st: "Too many login attempts…" (HTTP 429). The counter is in server memory: restart the server to reset it, and expect it to interfere with L-07 to L-09 if you run them back to back. |
| L-11 | Submit the form with an empty field | The browser blocks it. Via curl with `{}`: 400 `VALIDATION_FAILED`, with `details` naming each field. |
| L-12 | Username `' OR 1=1 --`, password `x` | The normal "Invalid username or password.", nothing else |
| L-13 | Login page at 400 px wide, and using only the keyboard (Tab, Enter) | Fully usable |

### 4.2 Sessions

| ID | Steps | Expected |
|---|---|---|
| S-01 | After login: DevTools → Application → Cookies | One cookie `xp_sid`: **HttpOnly** ✓, **SameSite=Strict**, expires in about 12 h. **Secure ✓ on staging and production** (it's off locally on plain http). |
| S-02 | In the console, type `document.cookie` | `xp_sid` is **not** listed |
| S-03 | DevTools → Application → Local Storage and Session Storage | No user data, scores or locks are stored (unlike the legacy portal) |
| S-04 | Reload the page | Still logged in |
| S-05 | Copy the `xp_sid` value, click Logout, then `curl -b "xp_sid=<value>" …/api/auth/me` | 401: the old cookie is dead on the server, not just deleted in the browser |
| S-06 | Idle timeout: `UPDATE "Session" SET "lastSeenAt"=now()-interval '21 minutes';` then reload | Login page. Real-time variant: leave the tab untouched for 21 minutes. |
| S-07 | Absolute limit: `UPDATE "Session" SET "expiresAt"=now()-interval '1 minute';` then reload | Login page |
| S-08 | Log in on browsers A and B as the same user; log out in A | B is still logged in (in M0, several devices are allowed outside exams) |
| S-09 | While logged in, deactivate the user (as in L-06) and reload | Logged out at once |
| S-10 | `curl …/api/auth/me` with no cookie | 401 `{"error":"UNAUTHENTICATED"}` |

> **Expected behaviour, not a bug:**
> - The idle timeout can take up to about 21 minutes instead of 20, because activity is saved at most once a minute.
> - In M0, only requests to the server count as activity: reloading does, clicking around a static page doesn't.

### 4.3 Password change

| ID | Steps | Expected |
|---|---|---|
| P-01 | On the forced change page, reload, or open `/` in a new tab | Still the change page; no way around it |
| P-02 | New and confirm fields differ | "The new passwords do not match." |
| P-03 | Wrong current password | "Your current password is incorrect." |
| P-04 | Try each new password: `short1`; `abcdefghijkl` (no digit); `123456789012` (no letter); `qa.stu1-2026-pass` (contains the username); the current password; 129 characters | Each one is rejected with a clear reason |
| P-05 | Valid new password, e.g. `Kestrel-river-42` | Home page with the name and role; `mustChangePassword` is false in the DB |
| P-06 | Log in on browser B, then change the password on browser A | B is logged out on its next reload; A stays logged in |
| P-07 | Log out and log in again | The new password works; the temporary one doesn't |
| P-08 | "Sign out" link on the change page | Returns to Login |

### 4.4 Admin scripts

| ID | Steps | Expected |
|---|---|---|
| A-01 | `create-super-admin` for a new username | Prints a temporary password once. Login forces a change, then the header shows the role "Super Admin". |
| A-02 | Run it again for the same username while that admin is logged in somewhere | A new password is printed, the old one stops working, and the existing session is logged out |
| A-03 | Import `qa.csv` (§3.2) | "Imported 3 user(s)". Groups `QA-Intake-A` and `QA-Intake-B` exist with their intake dates; `qa.stu2` has join date 2026-07-19; a credentials file was created. |
| A-04 | Import the same file again | "skipped 3"; no new credentials file; existing passwords unchanged |
| A-05 | Import a file with bad rows: username `A B`, email `not-an-email`, date `05/07/2026`, an empty fullName | Errors listed with line numbers. **No user from the file is imported**, valid rows included (check the user count before and after). |
| A-06 | Save the CSV from Excel (UTF-8 with BOM), including a name with a comma in quotes and an Arabic name | Names are stored exactly (check `SELECT "fullName" FROM "User";`) |

### 4.5 API and security basics

| ID | Steps | Expected |
|---|---|---|
| X-01 | `curl -i …/api/health/live` and `…/api/health/ready` | 200 `{"ok":true}`; `ready` fails if the database is down |
| X-02 | `curl -i …/api/does-not-exist` | 404 `{"error":"NOT_FOUND"}` (JSON, not HTML) |
| X-03 | Send the login as a form: `curl -d "username=qa.stu1&password=x" …/api/auth/login` | 415 `UNSUPPORTED_MEDIA_TYPE` (blocks forged cross-site forms) |
| X-04 | Body `{not json` with `Content-Type: application/json` | 400 `INVALID_REQUEST` |
| X-05 | JSON body over 100 KB | 413 `PAYLOAD_TOO_LARGE` |
| X-06 | In the Network tab, search all responses for `passwordHash`, `tokenHash`, `$2` (hash prefix) | Never present |
| X-07 | Docker build: `curl -I http://localhost:8080/` | `Content-Security-Policy` present, `X-Frame-Options` present, **no** `X-Powered-By` |
| X-08 | Make a local HTML file containing `<iframe src="http://localhost:8080">` and open it | The portal refuses to load in the frame |
| X-09 | Docker build: open `http://localhost:8080/some/deep/link` | The app loads (login page), not a 404 |
| X-10 | Server logs during the M0 tests | No passwords or session tokens appear in the logs |

### 4.6 Audit log and database rules

| ID | Steps | Expected |
|---|---|---|
| D-01 | After §4.1 to §4.4, run the query in §3.3 | Entries exist for `auth.login`, `auth.login_failed`, `auth.login_locked`, `auth.logout`, `auth.password_changed`, `admin.super_admin_bootstrap`, `admin.user_imported`, with the actor and IP |
| D-02 | `DELETE FROM "AuditLog";` and `UPDATE "AuditLog" SET action='x';` | Both fail: "AuditLog is append-only" |
| D-03 | Run the SQL below | Each insert marked ✗ fails with the named constraint |

```sql
BEGIN;
INSERT INTO "Exam"(id,code,title,"durationMinutes","updatedAt") VALUES ('00000000-0000-0000-0000-0000000000e1','QA-E','QA',30,now());
-- ✗ Assignment_one_target: no user and no group
INSERT INTO "Assignment"(id,"examId","mode") VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1','MANUAL');
ROLLBACK;
BEGIN;
INSERT INTO "Exam"(id,code,title,"durationMinutes","updatedAt") VALUES ('00000000-0000-0000-0000-0000000000e1','QA-E','QA',30,now());
-- ✗ Exam_sane_settings: zero duration
UPDATE "Exam" SET "durationMinutes"=0;
ROLLBACK;
BEGIN;
INSERT INTO "Exam"(id,code,title,"durationMinutes","updatedAt") VALUES ('00000000-0000-0000-0000-0000000000e1','QA-E','QA',30,now());
INSERT INTO "Attempt"(id,"examId","userId") SELECT gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1',id FROM "User" WHERE username='qa.stu1';
-- ✗ Attempt_one_in_progress: second in-progress attempt for the same exam
INSERT INTO "Attempt"(id,"examId","userId","attemptNo") SELECT gen_random_uuid(),'00000000-0000-0000-0000-0000000000e1',id,2 FROM "User" WHERE username='qa.stu1';
ROLLBACK;
```

---

## 5. M1 and M2: checklists to prepare now, run on delivery

For every staff permission test, check **both**: (a) the UI hides or disables the action, and (b) the API refuses it (HTTP 403) when called directly with that user's cookie.

### 5.1 Roles and access control (M1)

Test setup: two groups (A, B), three exams (E1, E2, E3), and these instructors:

| Instructor | Grants |
|---|---|
| `qa.inst.results` | `RESULTS_VIEW` on E1 × group A |
| `qa.inst.sched` | `EXAM_ASSIGN` + `EXAM_SCHEDULE` on all exams × group B |
| `qa.inst.split` | Two grants: `RESULTS_VIEW` on E1 × A, and `RESULTS_VIEW` on E2 × B |
| `qa.inst.expired` | `RESULTS_VIEW` on all exams × all groups, expired yesterday |

- [ ] `qa.inst.results` sees E1 results for group A only; E1 for group B, and E2 or E3, are invisible in the UI and 403 through the API
- [ ] `qa.inst.results` cannot schedule, assign, edit or proctor anything
- [ ] `qa.inst.sched` can schedule any exam for group B (or its members) but not group A; sees no results
- [ ] **Combination rule:** `qa.inst.split` sees E1×A and E2×B, but **not** E1×B or E2×A
- [ ] `qa.inst.expired` sees nothing
- [ ] Granting or removing a permission takes effect on the instructor's next request, without logging out
- [ ] A student opening a staff URL, or calling a staff API, gets "no access" or 403
- [ ] A student can never read another student's data by changing an ID in a URL or request (try every endpoint that takes an ID)
- [ ] The super admin can do everything, and every grant change appears in the audit log
- [ ] Changing a user's role or deactivating them ends their active sessions as designed

### 5.2 Users and groups (M1)

- [ ] Create, edit, deactivate and reactivate a user from the UI; a deactivated user can't log in and their session ends
- [ ] Password reset by the admin shows a one-time temporary password, and the user must change it
- [ ] CSV import from the UI: invalid rows are reported, nothing partial is saved, and the credentials are shown once
- [ ] A group's intake date can be edited; a member's own join date can be set for a late joiner

### 5.3 Assignment and scheduling (M1)

All times are **Africa/Cairo**. Egypt uses daylight saving time (summer time) from the last Friday of April to the last Thursday of October, so include one schedule that crosses that change.

- [ ] An exam that isn't assigned to a student never appears for them, even by URL or API
- [ ] Assigning to a group shows the exam to all current members; a member added later also sees it
- [ ] **Fixed:** at opening minus 1 minute → "Scheduled" with a countdown, and starting is refused (also by API); at the opening time → Available; after closing → not startable
- [ ] **Relative:** offset 14 days, 10:00, window 120 min:
  - [ ] A group member with no own join date → opens intake date + 14 days at 10:00 Cairo
  - [ ] `qa.stu2` (joined 2026-07-19) → opens 2026-08-02 at 10:00
  - [ ] A user-level assignment uses the user's own join date
  - [ ] The schedule preview in the admin UI matches what each student actually sees
- [ ] **Manual mode:** visible but closed until opened by an override
- [ ] **Override precedence:**
  - [ ] User CLOSE beats group OPEN; user OPEN beats group CLOSE
  - [ ] A group override beats the schedule
  - [ ] An override with an end time stops at that time
  - [ ] Removing an override restores the schedule
- [ ] A student who already submitted is **not** reopened by a group-wide "Open"; only an explicit reopen or void (M2) allows another attempt
- [ ] Every schedule and override change is in the audit log with the actor and reason

### 5.4 Locked-down exam session (M1: the most important area)

Use a test exam with 5 questions, 10 minutes, strike limit 3, fullscreen required. Run in Chrome, Edge and Firefox.

**Starting**
- [ ] Start when the exam isn't open (via the UI and via the API) → refused
- [ ] The rules must be accepted before Start; fullscreen is entered on Start; no question is visible outside fullscreen
- [ ] Open the exam in a second tab while it's in progress → the second tab is refused, or the first tab is stopped, as designed; never two active sessions
- [ ] Start or open the exam on a second computer (or another browser) → refused ("in progress elsewhere"), no questions shown, a strike is added; the first computer keeps working
- [ ] Close the browser and reopen it on the **same** computer → the attempt continues; log out and back in → it can no longer be continued (there is no "allow resume")
- [ ] Two students get different question and option orders (when shuffle is on)

**During the exam**
- [ ] Reload the page → resumes the **same** attempt, the timer continues (it doesn't reset), and saved answers are still selected
- [ ] Change the PC clock forward or back by an hour → the remaining time is unaffected (the server deadline rules)
- [ ] Disconnect the network for 30 seconds while answering → a "not saved" warning appears; after reconnecting, nothing is lost
- [ ] Network tab: search every exam response for `isCorrect`, `correct`, `answerKey` → **never present**
- [ ] The watermark shows the student's name and username (M2)
- [ ] The exam is fully usable with the keyboard

**Violations** (each one produces a warning overlay, a server record, and a strike count matching the server's)

| Action | Detected as |
|---|---|
| Press Esc or F11 to leave fullscreen | `FULLSCREEN_EXIT` |
| Alt+Tab, Win key, Ctrl+Tab, open a new tab | `TAB_HIDDEN` / `WINDOW_BLUR` |
| Win+Arrow (split screen), drag the window to a second monitor | `RESIZE` / `WINDOW_BLUR` |
| Ctrl+C, Ctrl+V, Ctrl+X, right-click | Blocked + `CLIPBOARD` / `CONTEXT_MENU` |
| Ctrl+P, Ctrl+S, Ctrl+U, F12, Ctrl+Shift+I | Blocked + `BLOCKED_SHORTCUT` |
| Open DevTools from the browser menu | `DEVTOOLS` (heuristic: report it if missed, but it's lower severity) |

- [ ] Strike 1 and 2 → warning, must re-enter fullscreen; strike 3 → **automatically submitted**, with the reason shown
- [ ] Forged requests (DevTools "Edit and Resend"):
  - [ ] An answer to another student's attempt ID → 403/404
  - [ ] An answer after the deadline → rejected
  - [ ] A submit request claiming fewer strikes → ignored

**Ending**
- [ ] The timer reaches 0 → submitted automatically; answers sent later are rejected
- [ ] After submit: browser Back, history, reopening the exam URL, a new tab → all show "Submitted", never a question; the API returns no questions
- [ ] Logging out and back in doesn't allow a new attempt
- [ ] Closing the browser mid-exam and returning after the deadline → the attempt was auto-submitted at the deadline
- [ ] Every start, submit, violation and auto-submit is in the audit log or violations list

### 5.5 Results (M1)

- [ ] Grading is correct for single-choice, multiple-choice (all correct options required, as specified) and true/false; check by hand on 3 attempts
- [ ] Students see their own score only after results are released (M2: RES-3); before that, "Pending"
- [ ] The total % and ranking match a hand calculation (weights 75% technical, 25% CTF)
- [ ] An instructor's results list contains only students from groups in scope (see §5.1)

### 5.6 Proctoring and operations (M2)

- [ ] The live board shows in-progress students, time left, heartbeat (it goes red within about 30 s of disconnecting a student's network) and strikes
- [ ] Force submit → the student's screen ends immediately with the reason
- [ ] Add 5 minutes → the student's timer increases without a reload
- [ ] Void or reopen requires a reason, is audited, and allows exactly one new attempt
- [ ] Attendance and warnings: penalties match the program rules; the 3rd warning flags removal
- [ ] The scorecard PNG matches the server data; certificate eligibility = 80% overall **and** at least 80% in every topic
- [ ] CSV export matches the results screen

### 5.7 Load (before the first live exam)

- [ ] 30 students (scripted or real) start the same exam within 1 minute: no errors, starting takes under 2 s
- [ ] 30 heartbeats every 10 s plus saves for 30 minutes: no errors, server CPU and memory stable
- [ ] The app container restarts mid-exam → students reconnect and continue; no attempt is lost

### 5.8 Lockdown browser (M2/M3)

- [ ] An exam that requires Safe Exam Browser refuses a normal browser with a clear message
- [ ] It works in Safe Exam Browser with the correct configuration, and refuses a modified configuration

---

## 6. Reporting bugs

**Severity**

| Level | Meaning | Examples |
|---|---|---|
| S1 Critical | Security or integrity broken | A student sees another's data; the answer key is exposed; an exam can be retaken after submit; access granted beyond scope |
| S2 High | A core flow is broken, with no workaround | Login fails; an exam can't be started or submitted; answers are lost |
| S3 Medium | Wrong behaviour with a workaround | Wrong countdown display; a missing audit entry |
| S4 Low | Cosmetic | Layout, wording |

**Template**

```
Title:        [Area] short description
Severity:     S1–S4
Build/commit: …
Environment:  local / staging · browser + version · OS
Account(s):   qa.stu1 (student) …
Time (Cairo): 2026-10-01 14:32
Steps:        1. … 2. … 3. …
Expected:     … (cite the case ID, e.g. L-07)
Actual:       …
Evidence:     screenshot / screen recording / HAR file / API response / SQL output
```

S1 bugs go straight to the team lead, not only the tracker, and aren't shared outside the team.

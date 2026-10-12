# API reference

All endpoints of the Xpand CS Academy backend: 52 routes, matching `apiRouteTable()` in `server/src/app.ts`.

- **Sections 2–5** list the endpoints of each role: everyone, students, instructors, super admins.
- **Section 6** covers every exam-related endpoint: catalog, assignment and scheduling, overrides, availability.
- **Section 7** is a quick matrix of who can call what.
- **Section 8** defines the shared response shapes.

When this file and the code disagree, the code wins. Update this file in the same pull request as the route change; the RBAC matrix test fails if a route has no access rows, but it can't check this document.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `/api` on the same origin as the web app. Cross-origin calls aren't supported. |
| Authentication | Session cookie `xp_sid` (HttpOnly, SameSite=Strict), set by `POST /api/auth/login`. The browser sends it automatically; never read or store it in JavaScript. |
| Session lifetime | Ends after 20 idle minutes or 12 hours, whichever comes first. Any request after that gets `401 UNAUTHENTICATED`. |
| Writes | `POST`/`PUT`/`PATCH`/`DELETE` must send `Content-Type: application/json` with a JSON body (send `{}` when there's nothing to send). Otherwise: `415 UNSUPPORTED_MEDIA_TYPE`. Maximum body size 100 KB. |
| Forced password change | While `user.mustChangePassword` is true, only `GET /api/auth/me`, `POST /api/auth/change-password` and `POST /api/auth/logout` work; everything else returns `403 PASSWORD_CHANGE_REQUIRED`. |
| Times | Instants are ISO 8601 UTC (`"2026-07-19T07:00:00.000Z"`); inputs may carry any offset. Calendar dates (`intakeStartDate`, `joinDate`) are `"YYYY-MM-DD"`. Schedule wall-clock times (`openTime`) are `"HH:mm"` in **Africa/Cairo** time. |
| IDs | UUIDs. A malformed ID returns `400 VALIDATION_FAILED`. |
| Pagination | Lists marked *paginated* take `?limit=` (1–200, default 50) and `?cursor=`, and return `{ items, nextCursor }`. Pass `nextCursor` back to get the next page; `null` means the last page. |
| Scope | Instructors only reach exams and students covered by their grants. A resource outside everything they can reach answers **404**, the same as a missing one. **403** means "you can see it, but you can't do this". |
| Audit | Every staff change is written to the audit log in the same transaction as the change. |

### Error responses

Every error body is `{ "error": CODE, "message"?: string, "details"?: … }`.

| HTTP | `error` | Meaning |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Input rejected. `details` = `[{ path, message }]`; `path` names the field (e.g. `"schedule.openTime"`). |
| 400 | `INVALID_REQUEST` | Malformed JSON |
| 400 | `WRONG_CURRENT_PASSWORD`, `WEAK_PASSWORD` | Password change; `WEAK_PASSWORD` has a readable `message` |
| 401 | `UNAUTHENTICATED` | No session, or it expired |
| 401 | `INVALID_CREDENTIALS` | Login failed; the same answer for an unknown user, a wrong password or a deactivated account |
| 403 | `PASSWORD_CHANGE_REQUIRED` | See Conventions |
| 403 | `FORBIDDEN` | Visible but not allowed. Bulk assignment adds `details` listing the refused pairs. |
| 404 | `NOT_FOUND` | Missing, or outside the caller's scope |
| 409 | `CONFLICT` | Duplicate or conflicting change; `message` explains, and `details` may list the conflicting rows |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | A write without a JSON body |
| 423 | `ACCOUNT_LOCKED` | 5 failed logins; `details.retryAfter` is when the lock ends (15 minutes) |
| 429 | `TOO_MANY_ATTEMPTS` | More than 20 login requests per IP in 15 minutes |
| 500 | `INTERNAL_ERROR` | A server bug; it's logged |

---

## 2. Public and every logged-in user

| Method | Path | Access |
|---|---|---|
| GET | `/api/health/live` | Public |
| GET | `/api/health/ready` | Public |
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/logout` | Public (no-op without a session) |
| GET | `/api/auth/me` | Logged in (also while a password change is pending) |
| POST | `/api/auth/change-password` | Logged in (also while a password change is pending) |
| GET | `/api/me/permissions` | Logged in |

**`GET /api/health/live`** → `200 { ok: true }` when the process is up.
**`GET /api/health/ready`** → `200 { ok: true }` when the database answers too. Used by Docker and uptime monitors.

**`POST /api/auth/login`**
```json
{ "username": "student.a", "password": "…" }
```
- The username is trimmed and compared case-insensitively.
- Success → `200 { user: User }` and sets the session cookie.
- Errors: `400 VALIDATION_FAILED`, `401 INVALID_CREDENTIALS`, `423 ACCOUNT_LOCKED`, `429 TOO_MANY_ATTEMPTS`.

**`POST /api/auth/logout`** → `204`. Ends the session on the server and clears the cookie.

**`GET /api/auth/me`** → `200 { user: User }`.

**`POST /api/auth/change-password`**
```json
{ "currentPassword": "…", "newPassword": "…" }
```
- The new password needs at least 10 characters (at most 128), letters and digits, must not contain the username, and must differ from the current one.
- Success → `200 { user: User }` with `mustChangePassword: false`; every **other** session of this user is signed out.
- Errors: `400 WRONG_CURRENT_PASSWORD`, `400 WEAK_PASSWORD` (with `message`).

**`GET /api/me/permissions`** → what the UI may show:
```json
{
  "role": "INSTRUCTOR",
  "grants": [
    { "permissions": ["EXAM_EDIT"], "allExams": false, "examIds": [], "categoryIds": ["…"],
      "allGroups": true, "groupIds": [], "expiresAt": null }
  ]
}
```
Only active (unexpired) grants are listed. Super admins and students get `grants: []`. The UI uses this only to hide what can't be used; the server checks every call regardless.

---

## 3. Student endpoints

| Method | Path | Access |
|---|---|---|
| GET | `/api/student/exams` | Students only |

Students also use everything in section 2. **`GET /api/student/exams`** is described with the exam endpoints in §6.5.

Students get `403 FORBIDDEN` on every staff endpoint.

---

## 4. Instructor endpoints

Instructors read people and groups **within their reach**: students in, and groups listed by, any of their active grants (a grant with "all groups" reaches everyone). They don't manage users, groups, grants, categories or tags.

| Method | Path | What they get |
|---|---|---|
| GET | `/api/users` | Paginated: **students in reach only**. Filters never widen this (e.g. `?role=INSTRUCTOR` → empty). |
| GET | `/api/users/:id` | A student in reach; otherwise `404` |
| GET | `/api/users/lookup` | Students in reach only (for pickers) |
| GET | `/api/groups` | Groups in reach |
| GET | `/api/groups/:id` | A group in reach, with its members; otherwise `404` |
| GET | `/api/catalog/categories` | All categories (pickers) |
| GET | `/api/catalog/tags` | All tags (pickers) |

Everything else an instructor does is **exam work**, controlled by grant permissions (§6). Query parameters and response shapes are the same as for super admins (§5.1, §5.2).

---

## 5. Super admin endpoints

Super admins pass every permission check, including all exam endpoints (§6). This section covers what only they can do.

### 5.1 Users

| Method | Path | Access |
|---|---|---|
| GET | `/api/users` | Super admin (instructors: §4) |
| GET | `/api/users/:id` | Super admin (instructors: §4) |
| POST | `/api/users` | Super admin |
| PATCH | `/api/users/:id` | Super admin |
| POST | `/api/users/:id/reset-password` | Super admin |
| GET | `/api/users/lookup` | Super admin (instructors: §4) |
| POST | `/api/users/import` | Super admin |

**`GET /api/users`** (*paginated*): returns `{ items: UserDetail[], nextCursor }`.

| Query | Meaning |
|---|---|
| `role` | `SUPER_ADMIN` / `INSTRUCTOR` / `STUDENT` |
| `groupId` | Members of this group |
| `q` | Text search in username and full name (case-insensitive) |
| `includeInactive` | `true` to include deactivated users (default `false`) |

**`GET /api/users/:id`** → `UserDetail`.

**`POST /api/users`** → `201 { user: UserDetail, temporaryPassword }`
```json
{ "username": "new.student", "fullName": "New Student", "email": null, "mobile": null,
  "role": "STUDENT", "joinDate": "2026-07-19", "groupIds": ["…"] }
```
- Only `username` and `fullName` are required.
- `username`: 3–50 characters (`a-z 0-9 . _ -`), lowercased.
- `role` defaults to `STUDENT`.
- The **temporary password is returned only once**; the user must change it at first login.
- Errors: `409 CONFLICT` (username taken), `400` (unknown groups).

**`PATCH /api/users/:id`** → `UserDetail`. Send any of `fullName`, `email`, `mobile`, `role`, `isActive`, `joinDate`.
- Changing the role, or setting `isActive: false`, **signs the user out everywhere**.
- `409 CONFLICT` if you try to change your own role or deactivate yourself. This also guarantees an active super admin always remains.

**`POST /api/users/:id/reset-password`** → `{ temporaryPassword }`. Unlocks the account, sets `mustChangePassword`, and signs the user out everywhere.

**`GET /api/users/lookup?q=&role=&limit=`** → `[{ id, username, fullName, role }]`: a light search for pickers. Active users only, in the same scope as the list, sorted by name. `limit` 1–50, default 20.

**`POST /api/users/import`** creates many students from CSV rows (the browser or the `import-users` script parses the file):
```json
{ "dryRun": true,
  "rows": [{ "username": "sara.ali", "fullName": "Sara Ali", "email": "", "mobile": "",
             "group": "Intake Nov 2026", "groupIntakeDate": "2026-11-01", "joinDate": "" }] }
```
- Columns: `username` and `fullName` are required; `email`, `mobile`, `group`, `groupIntakeDate`, `joinDate` are optional (an empty string = not given). Dates are `YYYY-MM-DD`. 1–200 rows.
- A `group` that doesn't exist yet is created; its rows must give one `groupIntakeDate`.
- **Dry run** (the default) → `200 ImportResult` with every problem and nothing written.
- **Real run** (`dryRun: false`) → `200 ImportResult` with `created`: each temporary password, **shown once**. If any row has a problem, nothing is created: `400 VALIDATION_FAILED`, `details` = `[{ path: "rows.<row>.<field>", row, message }]`.
- Checked: each row's fields, the same username twice in the file, usernames that already exist, new groups without (or with conflicting) intake dates.
- Each student, each new group and the import itself are audited (`users.created`, `groups.created`, `users.imported`).
- About 0.25 s per row (one password hash each), so a full file can take close to a minute.

### 5.2 Groups (cohorts / intakes)

| Method | Path | Access |
|---|---|---|
| GET | `/api/groups` | Super admin (instructors: §4) |
| GET | `/api/groups/:id` | Super admin (instructors: §4) |
| POST | `/api/groups` | Super admin |
| PATCH | `/api/groups/:id` | Super admin |
| POST | `/api/groups/:id/members` | Super admin |
| PATCH | `/api/groups/:id/members/:userId` | Super admin |
| DELETE | `/api/groups/:id/members/:userId` | Super admin |

- **`GET /api/groups`** → `Group[]`, newest intake first.
- **`GET /api/groups/:id`** → `GroupDetail` (with members).
- **`POST /api/groups`** `{ name, intakeStartDate: "YYYY-MM-DD" }` → `201 Group`. `409` on a duplicate name.
- **`PATCH /api/groups/:id`** `{ name?, intakeStartDate? }` → `Group`. Changing the intake date moves every relative schedule anchored on it.
- **`POST /api/groups/:id/members`** `{ userIds: [..], joinDate?: "YYYY-MM-DD" | null }` → `GroupDetail`.
  - Adds students; for students already in the group, it updates their join date.
  - `joinDate` is for **late joiners**: their relative schedules count from it instead of the intake date.
  - `400` if any ID isn't a student.
- **`PATCH /api/groups/:id/members/:userId`** `{ joinDate: "YYYY-MM-DD" | null }` → `GroupDetail`.
- **`DELETE /api/groups/:id/members/:userId`** → `204`. `404` if they aren't a member.

### 5.3 Instructor grants (access control)

| Method | Path | Access |
|---|---|---|
| GET | `/api/rbac/grants?userId=` | Super admin |
| POST | `/api/rbac/grants` | Super admin |
| PATCH | `/api/rbac/grants/:id` | Super admin |
| DELETE | `/api/rbac/grants/:id` | Super admin |

**`POST /api/rbac/grants`** → `201 Grant`
```json
{
  "userId": "…instructor id…",
  "permissions": ["EXAM_ASSIGN", "EXAM_SCHEDULE", "RESULTS_VIEW"],
  "allExams": false, "examIds": ["…"], "categoryIds": ["…"],
  "allGroups": false, "groupIds": ["…"],
  "expiresAt": "2026-12-31T22:00:00Z"
}
```

**Rules** (a violation → `400 VALIDATION_FAILED`, with `details[0].path` naming the field):
- `userId` must be an instructor.
- `permissions`: at least one; duplicates are removed.
- **Exam scope:** either `allExams: true`, or a non-empty `examIds` and/or `categoryIds`, but not both. A category covers every exam in it, including exams created later.
- **Group scope:** either `allGroups: true`, or a non-empty `groupIds`, but not both.
- Every listed ID must exist; `expiresAt` (optional) must be in the future.

**How grants work:**
- A grant allows an action only when **that one grant** has the permission and covers both the exam and the student's group. Two grants are never combined.
- Changes apply on the instructor's next request; they don't need to log out.

**`PATCH /api/rbac/grants/:id`**: any field except `userId`. Omitted fields keep their value; a list you send replaces the old one. The merged grant is validated with the same rules.

**`DELETE /api/rbac/grants/:id`** → `204`.

**Permissions:**

| Permission | Allows |
|---|---|
| `EXAM_EDIT` | Create and edit exams (in a category, or a listed exam), set their tags |
| `EXAM_ASSIGN` | Assign exams to students/groups, remove assignments, bulk assign |
| `EXAM_SCHEDULE` | Change schedules; open or close exams with overrides |
| `RESULTS_VIEW` | See results (and, like every permission, view the exam) |
| `RESULTS_RELEASE` | Publish results to students *(results endpoints come in the next phase)* |
| `PROCTOR` | Live session control *(next phase)* |
| `ATTEMPT_VOID` | Void or reopen attempts *(next phase)* |
| `ATTEMPT_REVIEW` | Move submitted attempts to under review / reviewed *(next phase)* |
| `AUDIT_VIEW` | Read the audit log *(next phase)* |

### 5.4 Categories and tags

| Method | Path | Access |
|---|---|---|
| GET | `/api/catalog/categories?includeArchived=` | Super admin, instructors |
| POST | `/api/catalog/categories` | Super admin |
| PATCH | `/api/catalog/categories/:id` | Super admin |
| DELETE | `/api/catalog/categories/:id` | Super admin |
| GET | `/api/catalog/tags` | Super admin, instructors |
| POST | `/api/catalog/tags` | Super admin |
| PATCH | `/api/catalog/tags/:id` | Super admin |
| DELETE | `/api/catalog/tags/:id` | Super admin |

**Categories** (one per exam, flat list):
- **`GET`** → `Category[]` with `examCount`, sorted by `position` then name. Archived categories are hidden unless `includeArchived=true`.
- **`POST`** `{ name, position? }` → `201 Category`.
  - The `slug` is generated from the name ("Operating Systems" → `operating-systems`). Names with no Latin letters get a short random slug.
  - `409` on a duplicate name, regardless of case.
- **`PATCH`** `{ name?, position?, archived? }` → `Category`.
  - Renaming keeps the slug.
  - Archived categories can't receive new exams.
- **`DELETE`** → `204`. `409` if any exam uses the category; archive it instead.

**Tags** (cross-cutting labels):
- **`GET`** → `Tag[]` with `examCount`.
- **`POST`** `{ name }` → `201 Tag` (`409` on a duplicate name, regardless of case).
- **`PATCH`** `{ name }` → `Tag` (rename).
- **`DELETE`** → `204`. Removes the tag from every exam; the audit log records how many.

### 5.5 Dashboard and audit log

| Method | Path | Access |
|---|---|---|
| GET | `/api/admin/stats` | Super admin |
| GET | `/api/audit` | Super admin (instructors with `AUDIT_VIEW` get a scoped view in a later phase) |
| GET | `/api/audit/actions` | Super admin |

**`GET /api/admin/stats`** → counts for the dashboard:
```json
{ "users": { "students": 120, "instructors": 6, "admins": 2, "inactive": 3, "locked": 1 },
  "groups": 4, "exams": { "draft": 2, "published": 9, "archived": 1 },
  "assignments": 31, "activeOverrides": 2, "activeSessions": 17 }
```
`users.students`, `instructors` and `admins` count active accounts; `inactive` counts deactivated ones; `locked` counts active accounts locked after failed logins. `activeSessions` counts sessions used in the last `SESSION_IDLE_MINUTES`.

**`GET /api/audit`** → `{ items: AuditEntry[], nextCursor }`, newest first. Reading the log is not itself audited.

| Query | Meaning |
|---|---|
| `action` | An exact action (`users.created`), or a prefix ending in `.` (`users.`) |
| `actorId` | Entries by this user |
| `entityType`, `entityId` | Entries about one record, e.g. `entityType=User&entityId=…` (a user's history) |
| `from`, `to` | Instants (ISO 8601), inclusive; `400` if `from` is after `to` |
| `cursor`, `limit` | As for other lists, except the cursor is the numeric `id` of the last entry |

**`GET /api/audit/actions`** → the distinct actions in the log, sorted (for the filter).

---

## 6. Exam endpoints

All endpoints that create, find, assign, schedule or open exams. The "Who" column uses these terms:

| Term | Meaning |
|---|---|
| **SA** | Super admin (always allowed) |
| **Perm X** | An instructor with permission X in a grant that covers *this exam* (by ID, category or all exams) *and* the target students (by group, or all groups) |
| **Any perm** | An instructor with any permission on the exam |
| **Student** | Students |

### 6.1 Exam catalog

| Method | Path | Who |
|---|---|---|
| GET | `/api/catalog/exams` | SA; instructors (list limited to exams they reach) |
| POST | `/api/catalog/exams` | SA; Perm `EXAM_EDIT` on the target **category** |
| GET | `/api/catalog/exams/:id` | SA; Any perm on the exam |
| PATCH | `/api/catalog/exams/:id` | SA; Perm `EXAM_EDIT` on the exam |
| PUT | `/api/catalog/exams/:id/tags` | SA; Perm `EXAM_EDIT` on the exam |

**`GET /api/catalog/exams`** (*paginated*) → `{ items: Exam[], nextCursor, total }`. Filters apply *inside* the caller's reach:

| Query | Meaning |
|---|---|
| `categoryId` | Exams in this category |
| `tagIds` | Comma-separated tag IDs; the exam must have **all** of them |
| `status` | `DRAFT` / `PUBLISHED` / `ARCHIVED` |
| `q` | Text search in title and code |

**`POST /api/catalog/exams`** → `201 Exam`
```json
{ "code": "cloud-1", "title": "Cloud Gates", "categoryId": "…", "durationMinutes": 45,
  "tagIds": ["…"], "passMark": 80, "weight": 15, "maxAttempts": 1, "isExternal": false,
  "allowBackNavigation": true, "shuffleQuestions": true, "shuffleOptions": true,
  "questionsPerAttempt": null, "strikeLimit": 3, "requireFullscreen": true }
```
- Required: `code`, `title`, `categoryId`, `durationMinutes` (1–600). The other values shown are the defaults.
- `code` is uppercased and must be 2–31 characters (`A-Z 0-9 -`); `409` if it's already taken.
- Every new exam starts as `DRAFT`.
- `400` if the category is archived or a tag doesn't exist.

**`GET /api/catalog/exams/:id`** → `Exam`.

**`PATCH /api/catalog/exams/:id`** → `Exam`. Send any setting from the create body (except `code` and `tagIds`), plus `categoryId` and `status`:
- **Status:** `DRAFT` (hidden from students), `PUBLISHED`, `ARCHIVED` (shown to students as closed; can't be assigned).
- **Moving to another category** also requires `EXAM_EDIT` on the *destination* category (`403` otherwise), because it changes who reaches the exam. `400` if the destination is archived.

**`PUT /api/catalog/exams/:id/tags`** `{ tagIds: [..] }` → `Exam`. Replaces the exam's whole tag set; sending the same set again changes nothing.

### 6.2 Assigning and scheduling

| Method | Path | Who |
|---|---|---|
| GET | `/api/assignments?examId=` | SA; Perm `EXAM_ASSIGN` or `EXAM_SCHEDULE` (only targets they reach) |
| POST | `/api/assignments` | SA; Perm `EXAM_ASSIGN` covering the exam **and** the target |
| PATCH | `/api/assignments/:id` | SA; Perm `EXAM_SCHEDULE` covering the exam and the target |
| DELETE | `/api/assignments/:id` | SA; Perm `EXAM_ASSIGN` covering the exam and the target |
| POST | `/api/assignments/bulk` | SA; instructors (every exam × target pair is checked for `EXAM_ASSIGN`) |
| POST | `/api/assignments/preview` | Same as bulk; nothing is saved |

An assignment makes an exam **visible** to one target and says **when it opens**.

**Target:** exactly one of the two forms; anything else is `400`.

| Form | Meaning |
|---|---|
| `{ "userId": "…" }` | One student. A student is in an instructor's scope when *any* of their groups is. |
| `{ "groupId": "…" }` | A group |

**Schedule:** exactly one of these forms.

| `mode` | Fields | Meaning |
|---|---|---|
| `FIXED` | `opensAt` (instant), `closesAt` (instant or `null` = open-ended) | Fixed dates. Opens at `opensAt` (inclusive); closes at `closesAt` (exclusive). |
| `RELATIVE` | `offsetDays` (0–366), `openTime` (`"HH:mm"`, Cairo), `windowMinutes` (1–20160) | Opens at `openTime` Cairo time, `offsetDays` after the anchor date, for `windowMinutes`. Anchor for a group: the member's own `joinDate`, else the group's `intakeStartDate`. Anchor for a student target: that user's `joinDate`. |
| `MANUAL` | none | Visible but closed until staff open it with an override (§6.3) |

**Rules:**
- **A personal assignment replaces group assignments.** If a student has an assignment of their own for an exam, their groups' schedules are ignored for that exam. This lets a super admin give one student a different date.
- When a student has several group assignments for the same exam, it's open if *any* window is open.
- Each exam can be assigned to a given target only once: `409 CONFLICT` otherwise. Edit the existing assignment instead.
- Archived exams can't be assigned (`400`).

**`GET /api/assignments?examId=`** → `Assignment[]`.

**`POST /api/assignments`** → `201 Assignment`
```json
{ "examId": "…", "target": { "groupId": "…" },
  "schedule": { "mode": "RELATIVE", "offsetDays": 14, "openTime": "10:00", "windowMinutes": 120 } }
```

**`PATCH /api/assignments/:id`** `{ schedule }` → `Assignment`. Replaces the schedule; the target can't change.

**`DELETE /api/assignments/:id`** → `204`.

**`POST /api/assignments/bulk`** → `201 { created: n }`. Assigns several exams to several targets with one schedule. It creates the rows **once**; it isn't a live rule, so exams added to the category later aren't assigned.
```json
{ "categoryId": "…",                       // or "examIds": [..], or "tagIds": [..] (must have all)
  "targets": [{ "groupId": "…" }, { "userId": "…" }],
  "schedule": { "mode": "MANUAL" } }
```
- **Choose exams** with exactly one of `examIds`, `categoryId` or `tagIds`.
  - Category and tag selections include only non-archived exams that the caller can see.
  - With `examIds`, an exam the caller can't see counts as non-existent (`400`).
- **All or nothing:**
  - `403 FORBIDDEN` if any exam × target pair isn't allowed; `details` = `[{ examId, target }]` lists the refused pairs.
  - `409 CONFLICT` if any pair is already assigned; `details` lists the existing rows.
  - `400` if no exam matches.
  - In all three cases, nothing is saved.

**`POST /api/assignments/preview`** (same body and access checks as bulk) → one row per affected student and exam, **without saving**. Unlike bulk, it doesn’t refuse pairs that are already assigned, so it also previews a schedule change:
```json
[{ "examId": "…", "examTitle": "Cloud Gates",
   "student": { "id": "…", "username": "student.b", "fullName": "…" },
   "anchorDate": "2026-07-05T00:00:00.000Z",
   "opensAt": "2026-07-19T07:00:00.000Z", "closesAt": "2026-07-19T09:00:00.000Z",
   "replacedByPersonalAssignment": false }]
```
The preview uses the same calculation the server uses for students, so it always matches what they'll see. `replacedByPersonalAssignment: true` means the student has a personal assignment for that exam, so this group schedule wouldn't apply to them.

### 6.3 Opening and closing now (overrides)

| Method | Path | Who |
|---|---|---|
| GET | `/api/overrides?examId=&includeEnded=` | SA; Perm `EXAM_ASSIGN` or `EXAM_SCHEDULE` (only targets they reach) |
| POST | `/api/overrides` | SA; Perm `EXAM_SCHEDULE` covering the exam and the target |
| POST | `/api/overrides/:id/end` | SA; Perm `EXAM_SCHEDULE` covering the exam and the target |

An override opens or closes an exam **on top of** its schedule.

**Precedence:**
1. The student's newest personal override wins.
2. Otherwise group overrides apply; a group CLOSE beats a group OPEN.
3. Otherwise the schedule decides.

An override never reopens an exam whose attempts are all used, and an override alone doesn't make an unassigned exam visible.

**`GET /api/overrides`** → `Override[]`. Active ones only, unless `includeEnded=true`.

**`POST /api/overrides`** → `201 Override`
```json
{ "examId": "…", "target": { "userId": "…" }, "action": "OPEN",
  "validFrom": "2026-07-20T07:00:00Z", "validUntil": "2026-07-20T09:00:00Z",
  "reason": "Approved make-up assessment" }
```
- `reason` is required.
- `validFrom` defaults to now; `validUntil` defaults to `null` (no end).

**`POST /api/overrides/:id/end`** → `Override` (now `active: false`).
- Ends the override immediately by setting `validUntil` to now; the record stays for history.
- `409` if it has already ended.

### 6.4 Availability: "why is this open?"

| Method | Path | Who |
|---|---|---|
| GET | `/api/assignments/availability?examId=` | SA; Any perm on the exam (only students they reach) |

Returns every student the exam is assigned to (directly or through a group), each with their resolved state:
```json
[{ "student": { "id": "…", "username": "student.a", "fullName": "…" },
   "status": "OPEN", "progress": "NOT_STARTED",
   "opensAt": "…", "closesAt": "…",
   "source": "group-override", "reason": "Opened by staff." }]
```
`source` says what decided the status: `none`, `exam`, `attempts`, `user-override`, `group-override`, `user-assignment` or `group-assignment`.

### 6.5 The student's exam list

| Method | Path | Who |
|---|---|---|
| GET | `/api/student/exams` | Student (their own exams only) |

Returns the exams assigned to the calling student. **Draft and unassigned exams never appear.**
```json
[{
  "exam": { "id": "…", "code": "CLOUD-1", "title": "Cloud Gates",
            "category": { "id": "…", "name": "Cloud", "slug": "cloud" },
            "tags": [{ "id": "…", "name": "core", "slug": "core" }],
            "durationMinutes": 45, "isExternal": false,
            "materials": [{ "title": "Slides", "url": "https://…" }] },
  "status": "SCHEDULED", "progress": "NOT_STARTED",
  "opensAt": "2026-07-19T07:00:00.000Z", "closesAt": "2026-07-19T09:00:00.000Z",
  "reason": "Opens at the scheduled time."
}]
```

### 6.6 Exam statuses for one student

The server decides both values; the UI only displays them.

**`status`: can the student take it?**

| Value | Meaning |
|---|---|
| `NOT_ASSIGNED` | No assignment reaches the student (only in the staff view) |
| `SCHEDULED` | Opens later; `opensAt` gives the earliest upcoming window |
| `OPEN` | Can start now, or resume an attempt already in progress. `closesAt` is when it closes (`null` = open-ended). |
| `CLOSED` | Not open: closed by staff, manual-only, a draft or archived exam, or the window has ended after an attempt |
| `MISSED` | Every window has ended and the student never attempted it |
| `SUBMITTED` | All attempts have been used |
| `EXTERNAL` | Taken outside the platform (e.g. CTF); scores are entered by staff |

**`progress`: how far the student is**

| Value | Meaning |
|---|---|
| `NOT_STARTED` | No attempt yet |
| `IN_PROGRESS` | An attempt is running |
| `ANSWERED` | Submitted, waiting for review |
| `UNDER_REVIEW` | Staff are reviewing it |
| `REVIEWED` | Review finished |

---

## 7. Quick matrix: who can call what

Legend: ✅ allowed · 🔑 instructors with the named permission on the exam/target (otherwise 404, or 403 when they can see it) · 👁 instructors, limited to what they reach · ❌ 403 · — 401 (anonymous).

| Endpoint | Anonymous | Student | Instructor | Super admin |
|---|---|---|---|---|
| `GET /api/health/*`, `POST /api/auth/login`, `POST /api/auth/logout` | ✅ | ✅ | ✅ | ✅ |
| `GET /api/auth/me`, `POST /api/auth/change-password`, `GET /api/me/permissions` | — | ✅ | ✅ | ✅ |
| `GET /api/student/exams` | — | ✅ | ❌ | ❌ |
| `GET /api/users`, `GET /api/users/:id` | — | ❌ | 👁 students | ✅ |
| `GET /api/users/lookup` | — | ❌ | 👁 students | ✅ |
| `POST/PATCH /api/users…`, `POST /api/users/:id/reset-password`, `POST /api/users/import` | — | ❌ | ❌ | ✅ |
| `GET /api/groups`, `GET /api/groups/:id` | — | ❌ | 👁 | ✅ |
| Group writes and members | — | ❌ | ❌ | ✅ |
| `/api/rbac/grants` (all) | — | ❌ | ❌ | ✅ |
| `GET /api/catalog/categories`, `GET /api/catalog/tags` | — | ❌ | ✅ | ✅ |
| Category and tag writes | — | ❌ | ❌ | ✅ |
| `GET /api/catalog/exams` | — | ❌ | 👁 | ✅ |
| `GET /api/catalog/exams/:id` | — | ❌ | 🔑 any | ✅ |
| `POST /api/catalog/exams`, `PATCH …/:id`, `PUT …/:id/tags` | — | ❌ | 🔑 `EXAM_EDIT` | ✅ |
| `GET /api/assignments`, `GET /api/overrides` | — | ❌ | 🔑 `EXAM_ASSIGN` or `EXAM_SCHEDULE` | ✅ |
| `POST /api/assignments`, `DELETE /api/assignments/:id` | — | ❌ | 🔑 `EXAM_ASSIGN` | ✅ |
| `POST /api/assignments/bulk`, `…/preview` | — | ❌ | 🔑 `EXAM_ASSIGN` on every pair | ✅ |
| `PATCH /api/assignments/:id`, `POST /api/overrides`, `POST /api/overrides/:id/end` | — | ❌ | 🔑 `EXAM_SCHEDULE` | ✅ |
| `GET /api/assignments/availability` | — | ❌ | 🔑 any | ✅ |
| `GET /api/admin/stats`, `GET /api/audit`, `GET /api/audit/actions` | — | ❌ | ❌ | ✅ |

The authoritative version, with every endpoint × 8 test users, is the RBAC matrix in the code: `server/src/modules/*/*.matrix.ts`, run by `server/src/rbac.matrix.int.test.ts`.

---

## 8. Shared shapes

**User** (from login, `/auth/me`, `/auth/change-password`):
```ts
{ id, username, fullName, email: string | null, mobile: string | null,
  role: "SUPER_ADMIN" | "INSTRUCTOR" | "STUDENT", mustChangePassword: boolean }
```

**UserDetail** (from `/api/users`): User plus
```ts
{ isActive: boolean, lockedUntil: string | null /* locked while in the future */, joinDate: "YYYY-MM-DD" | null,
  groups: { id, name, joinDate: "YYYY-MM-DD" | null }[], createdAt }
```

**Group**: `{ id, name, intakeStartDate: "YYYY-MM-DD", memberCount }`

**GroupDetail**: Group plus
```ts
{ members: { id, username, fullName, isActive,
             joinDate: "YYYY-MM-DD" | null,              // late-joiner override
             effectiveJoinDate: "YYYY-MM-DD" }[] }       // joinDate ?? intakeStartDate
```

**Grant**:
```ts
{ id, userId, user: { username, fullName }, permissions: Permission[],
  allExams, examIds: string[], categoryIds: string[], allGroups, groupIds: string[],
  expiresAt: string | null, active: boolean, createdAt, createdById }
```

**Category**: `{ id, name, slug, position, archived, examCount? }` · **Tag**: `{ id, name, slug, examCount? }`

**Exam**:
```ts
{ id, code, title, status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  category: { id, name, slug }, tags: { id, name, slug }[],
  durationMinutes, passMark, weight, maxAttempts, isExternal,
  allowBackNavigation, shuffleQuestions, shuffleOptions,
  questionsPerAttempt: number | null, strikeLimit, requireFullscreen, createdAt, updatedAt }
```

**Assignment**:
```ts
{ id, examId,
  target: { type: "group", id, name } | { type: "user", id, name, username },
  schedule: { mode: "FIXED" | "RELATIVE" | "MANUAL", opensAt, closesAt,
              offsetDays, openTime, windowMinutes },   // fields of other modes are null
  createdAt, createdById }
```

**ImportResult**:
```ts
{ dryRun: boolean,
  errors: { row: number /* 1-based data row; CSV line = row + 1 */, field: string, message: string }[],
  summary: { users: number, newGroups: string[], existingGroups: string[] },
  created: { username, fullName, temporaryPassword }[] }   // real run only
```

**AuditEntry**:
```ts
{ id: string /* numeric */, at, actor: { id, username, fullName } | null, action,
  entityType: string | null, entityId: string | null, detail: unknown, ip: string | null }
```

**Override**:
```ts
{ id, examId, target: (as in Assignment), action: "OPEN" | "CLOSE",
  validFrom, validUntil: string | null, active: boolean, reason, createdAt, createdById }
```

# Xpand CS Academy portal — architecture (M0)

Replaces the Google Apps Script prototype (`frontend.html`, `frontend.js`, `portal.json`, `test/`), which stays in the repo as a reference until M1 reaches feature parity.

## Stack

| Layer | Choice |
|---|---|
| Backend | Node 24, TypeScript, Express 5, Zod |
| Database | PostgreSQL 17 through Prisma 7 (`@prisma/adapter-pg`) |
| Frontend | React 19, Vite, Tailwind 4 |
| Deployment | One Docker image (API + built web app) plus Postgres, via `docker-compose.yml` on EC2 |

## Layout

```
server/
  prisma/schema.prisma        data model
  prisma/migrations/          SQL migrations (init includes hand-written constraints)
  src/auth/                   passwords, sessions, login routes, middleware
  src/rbac/authorize.ts       pure permission check (unit tested)
  src/audit.ts                append-only audit log writer
  scripts/                    create-super-admin, import-users
web/src/                      React app
```

## Authentication

- Passwords are hashed with bcrypt (cost 12). Imported and bootstrapped accounts get a random temporary password and must change it at first login.
- Login returns one generic error for an unknown user, a wrong password or a deactivated account, and runs a hash comparison even when the user doesn't exist so timing reveals nothing.
- 5 failed attempts lock the account for 15 minutes; the login route is also rate limited per IP.
- Sessions are opaque 256-bit tokens in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Only the SHA-256 of the token is stored.
- Sessions end after 20 idle minutes or 12 hours, whichever comes first. Both are enforced on the server.
- Changing the password signs out every other session.
- CSRF: state-changing API calls must be `application/json` (cross-site forms can't send that without a CORS preflight, and no cross-origin requests are allowed), on top of the SameSite cookie.

## Access control

Roles: `SUPER_ADMIN`, `INSTRUCTOR`, `STUDENT`.

An instructor's rights come from **grants**. Each grant combines a set of permissions with an exam scope (listed exams, or all) and a group scope (listed groups, or all), plus an optional expiry date.

`authorize(principal, permission, { examId?, groupId? })`:

- A super admin is always allowed.
- An instructor is allowed only when **one** unexpired grant has the permission and covers both the exam and the group. Scopes from different grants are never combined: grant 1 (exam A, group X) plus grant 2 (exam B, group Y) does not allow exam A for group Y.
- A student holds no staff permissions. Access to their own data is checked by ownership in each route.

Permissions: `EXAM_EDIT`, `EXAM_ASSIGN`, `EXAM_SCHEDULE`, `RESULTS_VIEW`, `RESULTS_RELEASE`, `PROCTOR`, `ATTEMPT_VOID`, `AUDIT_VIEW`.

## Assignment and scheduling (data model; logic arrives in M1)

- An `Assignment` makes an exam visible to **one user or one group** (a database CHECK enforces exactly one target).
  - `FIXED`: `opensAt` to `closesAt`.
  - `RELATIVE`: anchor date + `offsetDays`, at `openTime` (Africa/Cairo), open for `windowMinutes`.
    - Anchor for a group assignment: the member's `GroupMember.joinDate`, or else the group's `intakeStartDate`.
    - Anchor for a user assignment: `User.joinDate`.
  - `MANUAL`: visible, but opens only through an override.
- An `AccessOverride` opens or closes an exam manually for a user or group. Precedence: user override > group override > assignment schedule > closed.

## Exam attempts (data model; logic arrives in M1)

- Attempts are created by the server, with a server-side `deadlineAt`; the client timer is display only.
- The database allows **at most one `IN_PROGRESS` attempt per student per exam** (a partial unique index), so two tabs or devices can't both start.
- `(examId, userId, attemptNo)` is unique, and `Exam.maxAttempts` defaults to 1.
- `Option.isCorrect` is never sent to students; grading happens on the server.
- Each attempt stores its randomized question and option order, the browser session it is bound to, the last heartbeat time and the strike count. `Violation` rows record every client-side signal.

## Audit log

`AuditLog` is append-only: a database trigger rejects every UPDATE or DELETE. The single exception is the foreign key setting `actorId` to null when a user is deleted.

import { statuses, superAdminOnly, type MatrixRow } from "../../test/matrix.js";

export const authAndRbacRows: MatrixRow[] = [
  { route: "GET /api/auth/me", request: () => ({ path: "/api/auth/me" }), expect: statuses(200) },
  {
    route: "POST /api/auth/change-password",
    label: "wrong current password",
    request: () => ({
      path: "/api/auth/change-password",
      body: { currentPassword: "not-the-password-1", newPassword: "Another-pass-123" },
    }),
    expect: statuses(400),
  },
  { route: "GET /api/me/permissions", request: () => ({ path: "/api/me/permissions" }), expect: statuses(200) },

  { route: "GET /api/rbac/grants", request: () => ({ path: "/api/rbac/grants" }), expect: superAdminOnly(200) },
  {
    route: "POST /api/rbac/grants",
    request: (w) => ({
      path: "/api/rbac/grants",
      body: { userId: w.users.instNone.id, permissions: ["RESULTS_VIEW"], examIds: [w.e1.id], allGroups: true },
    }),
    expect: superAdminOnly(201),
  },
  {
    route: "PATCH /api/rbac/grants/:id",
    request: (w) => ({ path: `/api/rbac/grants/${w.examAGrant.id}`, body: { permissions: ["RESULTS_VIEW"] } }),
    expect: superAdminOnly(200),
  },
  {
    route: "DELETE /api/rbac/grants/:id",
    request: (w) => ({ path: `/api/rbac/grants/${w.examAGrant.id}` }),
    expect: superAdminOnly(204),
  },
];

export const usersRows: MatrixRow[] = [
  { route: "GET /api/users", request: () => ({ path: "/api/users" }), expect: statuses(200, { student: 403 }) },
  // Scoped like the list: instructors get only students in reach (an empty list, not an error).
  {
    route: "GET /api/users/lookup",
    request: () => ({ path: "/api/users/lookup?q=student" }),
    expect: statuses(200, { student: 403 }),
  },
  {
    route: "POST /api/users/import",
    label: "dry run",
    request: () => ({ path: "/api/users/import", body: { rows: [{ username: "imp.one", fullName: "Imp One" }] } }),
    expect: superAdminOnly(200),
  },
  {
    route: "GET /api/users/:id",
    label: "student in group A",
    request: (w) => ({ path: `/api/users/${w.users.student.id}` }),
    // Reachable through group A (instExamA, instSplit) or all groups (instCategory); hidden otherwise.
    // instTag: student A has submitted no "core" exam.
    expect: statuses(200, { student: 403, instNone: 404, instExpired: 404, instTag: 404 }),
  },
  {
    route: "GET /api/users/:id",
    label: "student in group B",
    request: (w) => ({ path: `/api/users/${w.studentB.id}` }),
    // instTag: student B has submitted E1, which carries "core".
    expect: statuses(200, { student: 403, instNone: 404, instExamA: 404, instExpired: 404 }),
  },
  {
    route: "GET /api/users/:id",
    label: "a staff member (never visible to instructors)",
    request: (w) => ({ path: `/api/users/${w.users.instNone.id}` }),
    expect: statuses(404, { superAdmin: 200, student: 403 }),
  },
  {
    route: "POST /api/users",
    request: () => ({ path: "/api/users", body: { username: "new.student", fullName: "New Student" } }),
    expect: superAdminOnly(201),
  },
  {
    route: "PATCH /api/users/:id",
    request: (w) => ({ path: `/api/users/${w.studentB.id}`, body: { fullName: "Renamed" } }),
    expect: superAdminOnly(200),
  },
  {
    route: "POST /api/users/:id/reset-password",
    request: (w) => ({ path: `/api/users/${w.studentB.id}/reset-password` }),
    expect: superAdminOnly(200),
  },
];

export const groupsRows: MatrixRow[] = [
  { route: "GET /api/groups", request: () => ({ path: "/api/groups" }), expect: statuses(200, { student: 403 }) },
  {
    route: "GET /api/groups/:id",
    label: "group A",
    request: (w) => ({ path: `/api/groups/${w.groupA.id}` }),
    // instTag: "students who submitted" grants never reach a group.
    expect: statuses(200, { student: 403, instNone: 404, instExpired: 404, instTag: 404 }),
  },
  {
    route: "GET /api/groups/:id",
    label: "group B",
    request: (w) => ({ path: `/api/groups/${w.groupB.id}` }),
    expect: statuses(200, { student: 403, instNone: 404, instExamA: 404, instExpired: 404, instTag: 404 }),
  },
  {
    route: "POST /api/groups",
    request: () => ({ path: "/api/groups", body: { name: "Group C", intakeStartDate: "2026-11-01" } }),
    expect: superAdminOnly(201),
  },
  {
    route: "PATCH /api/groups/:id",
    request: (w) => ({ path: `/api/groups/${w.groupA.id}`, body: { intakeStartDate: "2026-07-12" } }),
    expect: superAdminOnly(200),
  },
  {
    route: "POST /api/groups/:id/members",
    request: (w) => ({ path: `/api/groups/${w.groupA.id}/members`, body: { userIds: [w.studentB.id] } }),
    expect: superAdminOnly(200),
  },
  {
    route: "PATCH /api/groups/:id/members/:userId",
    request: (w) => ({
      path: `/api/groups/${w.groupA.id}/members/${w.users.student.id}`,
      body: { joinDate: "2026-07-19" },
    }),
    expect: superAdminOnly(200),
  },
  {
    route: "DELETE /api/groups/:id/members/:userId",
    request: (w) => ({ path: `/api/groups/${w.groupA.id}/members/${w.users.student.id}` }),
    expect: superAdminOnly(204),
  },
];

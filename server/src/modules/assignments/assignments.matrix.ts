import { statuses, type MatrixRow } from "../../test/matrix.js";

/** Scoped staff routes: out-of-scope instructors 404 (existence hidden), students 403. */
const scoped = (ok: number, overrides: Partial<Record<"instExamA" | "instCategory" | "instSplit", number>>) =>
  statuses(404, { superAdmin: ok, student: 403, ...overrides });

const fixedSchedule = { mode: "FIXED", opensAt: "2026-11-01T07:00:00Z", closesAt: "2026-11-01T09:00:00Z" };

export const assignmentsRows: MatrixRow[] = [
  {
    route: "GET /api/assignments",
    label: "E1",
    request: (w) => ({ path: `/api/assignments?examId=${w.e1.id}` }),
    // instSplit sees E1 (RESULTS_VIEW) but lacks EXAM_ASSIGN/EXAM_SCHEDULE.
    expect: scoped(200, { instExamA: 200, instSplit: 403 }),
  },
  {
    route: "POST /api/assignments",
    label: "E3 → group B",
    request: (w) => ({
      path: "/api/assignments",
      body: { examId: w.e3.id, target: { groupId: w.groupB.id }, schedule: { mode: "MANUAL" } },
    }),
    // Already assigned in the seed world → 409 for whoever is allowed to try.
    expect: scoped(409, { instCategory: 409 }),
  },
  {
    route: "POST /api/assignments",
    label: "E3 → student A",
    request: (w) => ({
      path: "/api/assignments",
      body: { examId: w.e3.id, target: { userId: w.users.student.id }, schedule: fixedSchedule },
    }),
    expect: scoped(201, { instCategory: 201 }),
  },
  {
    route: "POST /api/assignments",
    label: "E1 → student B (exam in instExamA's scope, group not)",
    request: (w) => ({
      path: "/api/assignments",
      body: { examId: w.e1.id, target: { userId: w.studentB.id }, schedule: fixedSchedule },
    }),
    expect: scoped(201, {}),
  },
  {
    route: "POST /api/assignments/bulk",
    request: (w) => ({
      path: "/api/assignments/bulk",
      body: { examIds: [w.e3.id], targets: [{ userId: w.users.student.id }], schedule: fixedSchedule },
    }),
    // Exams the caller cannot see are "not found" → 400 for the selection.
    expect: statuses(400, { superAdmin: 201, instCategory: 201, student: 403 }),
  },
  {
    route: "POST /api/assignments/preview",
    request: (w) => ({
      path: "/api/assignments/preview",
      body: { examIds: [w.e3.id], targets: [{ groupId: w.groupB.id }], schedule: fixedSchedule },
    }),
    expect: statuses(400, { superAdmin: 200, instCategory: 200, student: 403 }),
  },
  {
    route: "GET /api/assignments/availability",
    request: (w) => ({ path: `/api/assignments/availability?examId=${w.e1.id}` }),
    expect: scoped(200, { instExamA: 200, instSplit: 200 }),
  },
  {
    route: "PATCH /api/assignments/:id",
    label: "E1 → group A",
    request: (w) => ({ path: `/api/assignments/${w.assignmentE1A.id}`, body: { schedule: fixedSchedule } }),
    // instExamA may assign but not schedule.
    expect: scoped(200, { instExamA: 403, instSplit: 403 }),
  },
  {
    route: "DELETE /api/assignments/:id",
    label: "E3 → group B",
    request: (w) => ({ path: `/api/assignments/${w.assignmentE3B.id}` }),
    expect: scoped(204, { instCategory: 204 }),
  },
  {
    route: "GET /api/overrides",
    request: (w) => ({ path: `/api/overrides?examId=${w.e1.id}` }),
    expect: scoped(200, { instExamA: 200, instSplit: 403 }),
  },
  {
    route: "POST /api/overrides",
    request: (w) => ({
      path: "/api/overrides",
      body: { examId: w.e3.id, target: { groupId: w.groupB.id }, action: "OPEN", reason: "Make-up session" },
    }),
    expect: scoped(201, { instCategory: 201 }),
  },
  {
    route: "POST /api/overrides/:id/end",
    request: (w) => ({ path: `/api/overrides/${w.overrideE1A.id}/end` }),
    expect: scoped(200, { instExamA: 403, instSplit: 403 }),
  },
  {
    route: "GET /api/student/exams",
    request: () => ({ path: "/api/student/exams" }),
    expect: statuses(403, { student: 200 }),
  },
];

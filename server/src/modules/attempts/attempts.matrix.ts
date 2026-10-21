import { statuses, type MatrixRow } from "../../test/matrix.js";

// The exam session is for students only (staff 403), and only their own attempts: the world's one
// attempt is student B's, so student A gets 404 on all of them.
const own = statuses(403, { student: 404 });

export const attemptsRows: MatrixRow[] = [
  {
    route: "GET /api/student/exams/:id",
    label: "assigned",
    request: (w) => ({ path: `/api/student/exams/${w.e1.id}` }),
    expect: statuses(403, { student: 200 }),
  },
  {
    route: "GET /api/student/exams/:id",
    label: "not assigned",
    request: (w) => ({ path: `/api/student/exams/${w.e3.id}` }),
    expect: statuses(403, { student: 404 }),
  },
  {
    route: "POST /api/attempts",
    label: "open exam without questions",
    request: (w) => ({ path: "/api/attempts", body: { examId: w.e1.id } }),
    expect: statuses(403, { student: 409 }),
  },
  {
    route: "POST /api/attempts",
    label: "not assigned",
    request: (w) => ({ path: "/api/attempts", body: { examId: w.e3.id } }),
    expect: statuses(403, { student: 404 }),
  },
  {
    route: "GET /api/attempts/:id",
    request: (w) => ({ path: `/api/attempts/${w.attemptE1B.id}` }),
    expect: own,
  },
  {
    route: "GET /api/attempts/:id/outcome",
    request: (w) => ({ path: `/api/attempts/${w.attemptE1B.id}/outcome` }),
    expect: own,
  },
  {
    route: "PUT /api/attempts/:id/answers/:questionId",
    request: (w) => ({
      path: `/api/attempts/${w.attemptE1B.id}/answers/${w.questionE3.id}`,
      body: { selectedOptionIds: [] },
    }),
    expect: own,
  },
  {
    route: "POST /api/attempts/:id/position",
    request: (w) => ({ path: `/api/attempts/${w.attemptE1B.id}/position`, body: { index: 0 } }),
    expect: own,
  },
  {
    route: "POST /api/attempts/:id/events",
    request: (w) => ({ path: `/api/attempts/${w.attemptE1B.id}/events`, body: { type: "TAB_HIDDEN" } }),
    expect: own,
  },
  {
    route: "POST /api/attempts/:id/heartbeat",
    request: (w) => ({ path: `/api/attempts/${w.attemptE1B.id}/heartbeat` }),
    expect: own,
  },
  {
    route: "POST /api/attempts/:id/submit",
    request: (w) => ({ path: `/api/attempts/${w.attemptE1B.id}/submit` }),
    expect: own,
  },
];

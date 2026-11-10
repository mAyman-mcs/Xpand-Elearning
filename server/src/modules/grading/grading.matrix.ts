import { statuses, type MatrixRow } from "../../test/matrix.js";

// Grading needs ATTEMPT_REVIEW on the exam (queue) or on the exam AND the student (one attempt).
// In the world, only the super admin and instTag (every permission on "core" exams × students who
// submitted one: student B on E1) hold it. E1 is auto scored, so they get past access control and
// the handler answers 409 "nothing to grade"; the happy path is in grading.int.test.ts.
// Everyone else: 404 when they can't see the target at all, 403 when they can see it.

const ZERO = "00000000-0000-4000-8000-000000000000";

/** One attempt: student B (group B) on E1. No one but the two graders reaches that pair. */
const oneAttempt = statuses(404, { superAdmin: 409, instTag: 409, student: 403 });

export const gradingRows: MatrixRow[] = [
  {
    route: "GET /api/grading/exams/:examId",
    request: (w) => ({ path: `/api/grading/exams/${w.e1.id}` }),
    // instExamA and instSplit see E1 through RESULTS_VIEW, without ATTEMPT_REVIEW.
    expect: statuses(404, { superAdmin: 409, instTag: 409, student: 403, instExamA: 403, instSplit: 403 }),
  },
  {
    route: "GET /api/grading/attempts/:id",
    request: (w) => ({ path: `/api/grading/attempts/${w.attemptE1B.id}` }),
    expect: oneAttempt,
  },
  {
    route: "PUT /api/grading/attempts/:id/grades",
    request: (w) => ({
      path: `/api/grading/attempts/${w.attemptE1B.id}/grades`,
      body: { version: 0, grades: [{ questionId: ZERO, points: 0 }] },
    }),
    expect: oneAttempt,
  },
  {
    route: "POST /api/grading/attempts/:id/approve",
    request: (w) => ({ path: `/api/grading/attempts/${w.attemptE1B.id}/approve`, body: { version: 0 } }),
    expect: oneAttempt,
  },
  {
    route: "POST /api/grading/attempts/:id/reopen",
    request: (w) => ({ path: `/api/grading/attempts/${w.attemptE1B.id}/reopen`, body: { reason: "regrade" } }),
    expect: oneAttempt,
  },
];

// Submissions: the list is open to all staff and filtered to their scope; one preview needs
// RESULTS_VIEW or ATTEMPT_REVIEW on the exam AND the student (student B on E1: the super admin
// and instTag). instExamA and instSplit see E1 only for group A, and student B is in group B.
export const submissionsRows: MatrixRow[] = [
  {
    route: "GET /api/submissions",
    request: () => ({ path: "/api/submissions" }),
    expect: statuses(200, { student: 403 }),
  },
  {
    route: "GET /api/submissions/:id",
    request: (w) => ({ path: `/api/submissions/${w.attemptE1B.id}` }),
    expect: statuses(404, { superAdmin: 200, instTag: 200, student: 403 }),
  },
];

import type { AppDeps } from "../../core/context.js";
import { pageQuery } from "../../core/pagination.js";
import { access, ApiRouter } from "../../core/route.js";
import { idParams, uuid } from "../../core/schemas.js";
import { examScope } from "../rbac/resolvers.js";
import { z } from "zod";
import {
  approveAttempt,
  approveBody,
  attemptScope,
  getGrading,
  gradesBody,
  gradingQueue,
  queueQuery,
  reopenAttempt,
  reopenBody,
  saveGrades,
} from "./service.js";

/**
 * Mounted at /api/grading: manual grading of MANUAL_APPROVAL exams (docs/EXAM_TYPES_PLAN.md §3.5).
 * ATTEMPT_REVIEW on the exam, and — for one attempt — on its student too.
 */
export function gradingRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const review = access.permission("ATTEMPT_REVIEW");

  api.get("/exams/:examId", {
    access: review,
    params: z.object({ examId: uuid }),
    query: queueQuery.extend(pageQuery.shape),
    scope: (ctx, { params }) => examScope(ctx.db, params.examId),
    handler: (ctx, { params, query }) => gradingQueue(ctx, params.examId, query, query),
  });
  api.get("/attempts/:id", {
    access: review,
    params: idParams,
    scope: (ctx, { params }) => attemptScope(ctx.db, params.id),
    handler: (ctx, { params }) => getGrading(ctx, params.id),
  });
  api.put("/attempts/:id/grades", {
    access: review,
    params: idParams,
    body: gradesBody,
    scope: (ctx, { params }) => attemptScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => saveGrades(ctx, params.id, body),
  });
  api.post("/attempts/:id/approve", {
    access: review,
    params: idParams,
    body: approveBody,
    scope: (ctx, { params }) => attemptScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => approveAttempt(ctx, params.id, body),
  });
  api.post("/attempts/:id/reopen", {
    access: review,
    params: idParams,
    body: reopenBody,
    scope: (ctx, { params }) => attemptScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => reopenAttempt(ctx, params.id, body),
  });
  return api;
}

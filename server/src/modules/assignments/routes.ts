import type { AppDeps } from "../../core/context.js";
import { examBrief } from "../attempts/service.js";
import { access, ApiRouter, created, noContent } from "../../core/route.js";
import { idParams, queryBoolean } from "../../core/schemas.js";
import { examScope } from "../rbac/resolvers.js";
import {
  assignmentScope,
  bulkAssign,
  createAssignment,
  deleteAssignment,
  examTargetScope,
  listAssignments,
  previewAssignments,
  updateAssignment,
} from "./assignments.service.js";
import { examAvailability, studentExams } from "./availability.service.js";
import { createOverride, endOverride, listOverrides, overrideScope } from "./overrides.service.js";
import {
  bulkAssignmentBody,
  createAssignmentBody,
  createOverrideBody,
  examQuery,
  updateAssignmentBody,
} from "./schemas.js";

/** Mounted at /api/assignments. */
export function assignmentsRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const staff = access.roles("SUPER_ADMIN", "INSTRUCTOR");

  api.get("/", {
    access: access.permission("EXAM_ASSIGN", "EXAM_SCHEDULE"),
    query: examQuery,
    scope: (ctx, { query }) => examScope(ctx.db, query.examId),
    handler: (ctx, { query }) => listAssignments(ctx, query.examId),
  });

  api.post("/", {
    access: access.permission("EXAM_ASSIGN"),
    body: createAssignmentBody,
    scope: (ctx, { body }) => examTargetScope(ctx.db, body.examId, body.target),
    handler: async (ctx, { body }) => created(await createAssignment(ctx, body)),
  });

  // Bulk and preview check EXAM_ASSIGN on every exam × target pair inside the service.
  api.post("/bulk", {
    access: staff,
    body: bulkAssignmentBody,
    handler: async (ctx, { body }) => created(await bulkAssign(ctx, body)),
  });

  api.post("/preview", {
    access: staff,
    body: bulkAssignmentBody,
    handler: (ctx, { body }) => previewAssignments(ctx, body),
  });

  /** "Why is this open?": every reachable assigned student with status, source and reason. */
  api.get("/availability", {
    access: access.anyPermission(),
    query: examQuery,
    scope: (ctx, { query }) => examScope(ctx.db, query.examId),
    handler: (ctx, { query }) => examAvailability(ctx, query.examId),
  });

  api.patch("/:id", {
    access: access.permission("EXAM_SCHEDULE"),
    params: idParams,
    body: updateAssignmentBody,
    scope: (ctx, { params }) => assignmentScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => updateAssignment(ctx, params.id, body.schedule),
  });

  api.delete("/:id", {
    access: access.permission("EXAM_ASSIGN"),
    params: idParams,
    scope: (ctx, { params }) => assignmentScope(ctx.db, params.id),
    handler: async (ctx, { params }) => {
      await deleteAssignment(ctx, params.id);
      return noContent();
    },
  });

  return api;
}

/** Mounted at /api/overrides. */
export function overridesRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);

  api.get("/", {
    access: access.permission("EXAM_ASSIGN", "EXAM_SCHEDULE"),
    query: examQuery.extend({ includeEnded: queryBoolean(false) }),
    scope: (ctx, { query }) => examScope(ctx.db, query.examId),
    handler: (ctx, { query }) => listOverrides(ctx, query.examId, query.includeEnded),
  });

  api.post("/", {
    access: access.permission("EXAM_SCHEDULE"),
    body: createOverrideBody,
    scope: (ctx, { body }) => examTargetScope(ctx.db, body.examId, body.target),
    handler: async (ctx, { body }) => created(await createOverride(ctx, body)),
  });

  api.post("/:id/end", {
    access: access.permission("EXAM_SCHEDULE"),
    params: idParams,
    scope: (ctx, { params }) => overrideScope(ctx.db, params.id),
    handler: (ctx, { params }) => endOverride(ctx, params.id),
  });

  return api;
}

/** Mounted at /api/student. */
export function studentRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  api.get("/exams", { access: access.roles("STUDENT"), handler: (ctx) => studentExams(ctx) });
  // The pre-check page of one exam (rules, duration, whether it can start now).
  api.get("/exams/:id", {
    access: access.roles("STUDENT"),
    params: idParams,
    handler: (ctx, { params }) => examBrief(ctx, params.id),
  });
  return api;
}

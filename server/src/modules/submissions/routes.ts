import type { AppDeps } from "../../core/context.js";
import { pageQuery } from "../../core/pagination.js";
import { access, ApiRouter } from "../../core/route.js";
import { idParams } from "../../core/schemas.js";
import { attemptScope } from "../grading/service.js";
import { listSubmissions, previewSubmission, submissionsQuery } from "./service.js";

/** Mounted at /api/submissions: submitted exams, for staff (filtered to their scope). */
export function submissionsRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);

  // Open to every staff member: the list itself is filtered to what their grants reach.
  api.get("/", {
    access: access.roles("SUPER_ADMIN", "INSTRUCTOR"),
    query: submissionsQuery.extend(pageQuery.shape),
    handler: (ctx, { query }) => listSubmissions(ctx, query, query),
  });

  api.get("/:id", {
    access: access.permission("RESULTS_VIEW", "ATTEMPT_REVIEW"),
    params: idParams,
    scope: (ctx, { params }) => attemptScope(ctx.db, params.id),
    handler: (ctx, { params }) => previewSubmission(ctx, params.id),
  });

  return api;
}

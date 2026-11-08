import type { AppDeps } from "../../core/context.js";
import { access, ApiRouter, created } from "../../core/route.js";
import { idParams } from "../../core/schemas.js";
import { examScope } from "../rbac/resolvers.js";
import { readUpload, uploadBody, uploadImage, uploadQuery } from "./service.js";

/** The picture types accepted as a raw request body (CSRF-safe: a cross-site form can't send them). */
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Mounted at /api/uploads. */
export function uploadsRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);

  api.post("/", {
    access: access.permission("EXAM_EDIT"),
    query: uploadQuery,
    body: uploadBody,
    scope: (ctx, { query }) => examScope(ctx.db, query.examId),
    handler: async (ctx, { query, body }) => created(await uploadImage(ctx, query.examId, body)),
  });
  // Access is decided per picture (staff scope, or a student's open attempt): see readUpload.
  api.get("/:id", {
    access: access.authenticated(),
    params: idParams,
    handler: (ctx, { params }) => readUpload(ctx, params.id),
  });

  return api;
}

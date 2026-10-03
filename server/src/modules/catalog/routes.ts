import { z } from "zod";
import type { AppDeps } from "../../core/context.js";
import { pageQuery } from "../../core/pagination.js";
import { access, ApiRouter, created, noContent } from "../../core/route.js";
import { idParams, queryBoolean } from "../../core/schemas.js";
import { categoryScope, examScope } from "../rbac/resolvers.js";
import {
  createExam,
  createExamBody,
  examListQuery,
  examTagsBody,
  getExam,
  listExams,
  setExamTags,
  updateExam,
  updateExamBody,
} from "./exams.service.js";
import {
  categoryBody,
  categoryPatchBody,
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  listCategories,
  listTags,
  renameTag,
  tagBody,
  updateCategory,
} from "./taxonomy.service.js";

/** Mounted at /api/catalog. */
export function catalogRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const staff = access.roles("SUPER_ADMIN", "INSTRUCTOR");
  const superAdmin = access.roles("SUPER_ADMIN");

  // ── Categories & tags: readable by all staff (pickers), managed by super admins ──

  api.get("/categories", {
    access: staff,
    query: z.object({ includeArchived: queryBoolean(false) }),
    handler: (ctx, { query }) => listCategories(ctx, query),
  });
  api.post("/categories", {
    access: superAdmin,
    body: categoryBody,
    handler: async (ctx, { body }) => created(await createCategory(ctx, body)),
  });
  api.patch("/categories/:id", {
    access: superAdmin,
    params: idParams,
    body: categoryPatchBody,
    handler: (ctx, { params, body }) => updateCategory(ctx, params.id, body),
  });
  api.delete("/categories/:id", {
    access: superAdmin,
    params: idParams,
    handler: async (ctx, { params }) => {
      await deleteCategory(ctx, params.id);
      return noContent();
    },
  });

  api.get("/tags", { access: staff, handler: (ctx) => listTags(ctx) });
  api.post("/tags", {
    access: superAdmin,
    body: tagBody,
    handler: async (ctx, { body }) => created(await createTag(ctx, body)),
  });
  api.patch("/tags/:id", {
    access: superAdmin,
    params: idParams,
    body: tagBody,
    handler: (ctx, { params, body }) => renameTag(ctx, params.id, body),
  });
  api.delete("/tags/:id", {
    access: superAdmin,
    params: idParams,
    handler: async (ctx, { params }) => {
      await deleteTag(ctx, params.id);
      return noContent();
    },
  });

  // ── Exams: scoped by grants ──

  api.get("/exams", {
    access: staff,
    query: examListQuery.extend(pageQuery.shape),
    handler: (ctx, { query }) => listExams(ctx, query, query),
  });
  api.post("/exams", {
    access: access.permission("EXAM_EDIT"),
    body: createExamBody,
    scope: (ctx, { body }) => categoryScope(ctx.db, body.categoryId),
    handler: async (ctx, { body }) => created(await createExam(ctx, body)),
  });
  api.get("/exams/:id", {
    access: access.anyPermission(),
    params: idParams,
    scope: (ctx, { params }) => examScope(ctx.db, params.id),
    handler: (ctx, { params }) => getExam(ctx, params.id),
  });
  api.patch("/exams/:id", {
    access: access.permission("EXAM_EDIT"),
    params: idParams,
    body: updateExamBody,
    scope: (ctx, { params }) => examScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => updateExam(ctx, params.id, body),
  });
  api.put("/exams/:id/tags", {
    access: access.permission("EXAM_EDIT"),
    params: idParams,
    body: examTagsBody,
    scope: (ctx, { params }) => examScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => setExamTags(ctx, params.id, body.tagIds),
  });

  return api;
}

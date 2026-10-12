import { z } from "zod";
import type { AppDeps } from "../../core/context.js";
import { pageQuery } from "../../core/pagination.js";
import { access, ApiRouter, created, noContent } from "../../core/route.js";
import { idParams, queryBoolean } from "../../core/schemas.js";
import { categoryScope, examScope, materialScope, questionScope } from "../rbac/resolvers.js";
import {
  createMaterial,
  createQuestion,
  deleteMaterial,
  deleteQuestion,
  duplicateBody,
  duplicateExam,
  importQuestions,
  importQuestionsBody,
  listMaterials,
  listQuestions,
  materialBody,
  materialPatchBody,
  questionBody,
  questionPatchBody,
  reorderBody,
  reorderQuestions,
  updateMaterial,
  updateQuestion,
} from "./content.service.js";
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

  // ── Exam content (B5): staff with EXAM_EDIT on the exam. Includes the answer key. ──

  const edit = access.permission("EXAM_EDIT");
  const onExam = (ctx: { db: Parameters<typeof examScope>[0] }, { params }: { params: { id: string } }) =>
    examScope(ctx.db, params.id);

  api.get("/exams/:id/questions", {
    access: edit,
    params: idParams,
    scope: onExam,
    handler: (ctx, { params }) => listQuestions(ctx, params.id),
  });
  api.post("/exams/:id/questions", {
    access: edit,
    params: idParams,
    body: questionBody,
    scope: onExam,
    handler: async (ctx, { params, body }) => created(await createQuestion(ctx, params.id, body)),
  });
  api.put("/exams/:id/questions/order", {
    access: edit,
    params: idParams,
    body: reorderBody,
    scope: onExam,
    handler: (ctx, { params, body }) => reorderQuestions(ctx, params.id, body.questionIds),
  });
  api.post("/exams/:id/questions/import", {
    access: edit,
    params: idParams,
    body: importQuestionsBody,
    scope: onExam,
    handler: (ctx, { params, body }) => importQuestions(ctx, params.id, body),
  });
  api.patch("/questions/:id", {
    access: edit,
    params: idParams,
    body: questionPatchBody,
    scope: (ctx, { params }) => questionScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => updateQuestion(ctx, params.id, body),
  });
  api.delete("/questions/:id", {
    access: edit,
    params: idParams,
    scope: (ctx, { params }) => questionScope(ctx.db, params.id),
    handler: async (ctx, { params }) => {
      await deleteQuestion(ctx, params.id);
      return noContent();
    },
  });

  api.get("/exams/:id/materials", {
    access: edit,
    params: idParams,
    scope: onExam,
    handler: (ctx, { params }) => listMaterials(ctx, params.id),
  });
  api.post("/exams/:id/materials", {
    access: edit,
    params: idParams,
    body: materialBody,
    scope: onExam,
    handler: async (ctx, { params, body }) => created(await createMaterial(ctx, params.id, body)),
  });
  api.patch("/materials/:id", {
    access: edit,
    params: idParams,
    body: materialPatchBody,
    scope: (ctx, { params }) => materialScope(ctx.db, params.id),
    handler: (ctx, { params, body }) => updateMaterial(ctx, params.id, body),
  });
  api.delete("/materials/:id", {
    access: edit,
    params: idParams,
    scope: (ctx, { params }) => materialScope(ctx.db, params.id),
    handler: async (ctx, { params }) => {
      await deleteMaterial(ctx, params.id);
      return noContent();
    },
  });

  api.post("/exams/:id/duplicate", {
    access: edit,
    params: idParams,
    body: duplicateBody,
    scope: onExam,
    handler: async (ctx, { params, body }) => created(await duplicateExam(ctx, params.id, body)),
  });

  return api;
}

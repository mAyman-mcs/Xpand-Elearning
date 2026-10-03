import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { pageArgs, toPage, type Page, type PageQuery } from "../../core/pagination.js";
import { nonBlank, uuid, uuidList } from "../../core/schemas.js";
import { ExamStatus, type Prisma } from "../../generated/prisma/client.js";
import { authorize } from "../rbac/authorize.js";
import { examWhere, reachOf } from "../rbac/scope.js";

// ─────────────────────────────── Schemas ───────────────────────────────

const settings = {
  title: nonBlank(200),
  durationMinutes: z.number().int().min(1).max(600),
  passMark: z.number().min(0).max(100),
  weight: z.number().min(0).max(100),
  maxAttempts: z.number().int().min(1).max(10),
  isExternal: z.boolean(),
  allowBackNavigation: z.boolean(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  questionsPerAttempt: z.number().int().min(1).max(500).nullable(),
  strikeLimit: z.number().int().min(1).max(20),
  requireFullscreen: z.boolean(),
};

export const createExamBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, "2-31 characters: A-Z 0-9 and dashes"),
  categoryId: uuid,
  tagIds: uuidList.default([]),
  ...settings,
  // Defaults for everything but code, title, category and duration.
  passMark: settings.passMark.default(80),
  weight: settings.weight.default(15),
  maxAttempts: settings.maxAttempts.default(1),
  isExternal: settings.isExternal.default(false),
  allowBackNavigation: settings.allowBackNavigation.default(true),
  shuffleQuestions: settings.shuffleQuestions.default(true),
  shuffleOptions: settings.shuffleOptions.default(true),
  questionsPerAttempt: settings.questionsPerAttempt.default(null),
  strikeLimit: settings.strikeLimit.default(3),
  requireFullscreen: settings.requireFullscreen.default(true),
});

/** No defaults here: omitted fields keep their value (Zod's .partial() would keep defaults). */
export const updateExamBody = z.object({ ...settings, categoryId: uuid, status: z.enum(ExamStatus) }).partial();

export const examListQuery = z.object({
  categoryId: uuid.optional(),
  /** Comma-separated tag ids; an exam must carry all of them. */
  tagIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : []))
    .pipe(z.array(uuid).max(20)),
  status: z.enum(ExamStatus).optional(),
  q: z.string().trim().max(100).optional(),
});

export const examTagsBody = z.object({ tagIds: uuidList });

// ──────────────────────────────── DTOs ────────────────────────────────

const examInclude = {
  category: { select: { id: true, name: true, slug: true } },
  tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.ExamInclude;
type ExamRow = Prisma.ExamGetPayload<{ include: typeof examInclude }>;

export function examDto(e: ExamRow) {
  return {
    id: e.id,
    code: e.code,
    title: e.title,
    status: e.status,
    category: e.category,
    tags: e.tags.map((t) => t.tag).sort((a, b) => a.name.localeCompare(b.name)),
    durationMinutes: e.durationMinutes,
    passMark: e.passMark.toNumber(),
    weight: e.weight.toNumber(),
    maxAttempts: e.maxAttempts,
    isExternal: e.isExternal,
    allowBackNavigation: e.allowBackNavigation,
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    questionsPerAttempt: e.questionsPerAttempt,
    strikeLimit: e.strikeLimit,
    requireFullscreen: e.requireFullscreen,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
export type ExamDto = ReturnType<typeof examDto>;

// ─────────────────────────────── Queries ───────────────────────────────

/** Exams in the caller's reach through any permission, filtered inside that scope. */
export async function listExams(
  ctx: Ctx,
  filter: z.infer<typeof examListQuery>,
  page: PageQuery,
): Promise<Page<ExamDto> & { total: number }> {
  const where: Prisma.ExamWhereInput = {
    AND: [
      examWhere(reachOf(actorOf(ctx), "any", ctx.now)),
      filter.categoryId ? { categoryId: filter.categoryId } : {},
      filter.status ? { status: filter.status } : {},
      ...filter.tagIds.map((tagId) => ({ tags: { some: { tagId } } })),
      filter.q
        ? {
            OR: [
              { title: { contains: filter.q, mode: "insensitive" as const } },
              { code: { contains: filter.q, mode: "insensitive" as const } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.exam.findMany({
      where,
      include: examInclude,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      ...pageArgs(page),
    }),
    ctx.db.exam.count({ where }),
  ]);
  return { ...toPage(rows, page, examDto), total };
}

export async function getExam(ctx: Ctx, examId: string): Promise<ExamDto> {
  const exam = await ctx.db.exam.findUnique({ where: { id: examId }, include: examInclude });
  if (!exam) throw notFound("Exam not found.");
  return examDto(exam);
}

// ────────────────────────────── Commands ──────────────────────────────

const invalid = (path: string, message: string) => new AppError("VALIDATION_FAILED", { details: [{ path, message }] });

async function assertUsableCategory(db: DbClient, categoryId: string) {
  const category = await db.category.findUnique({ where: { id: categoryId }, select: { archived: true } });
  if (!category) throw invalid("categoryId", "Category not found.");
  if (category.archived) throw invalid("categoryId", "This category is archived.");
}

async function assertTagsExist(db: DbClient, tagIds: string[]) {
  if ((await db.tag.count({ where: { id: { in: tagIds } } })) !== tagIds.length) {
    throw invalid("tagIds", "Some tags do not exist.");
  }
}

export async function createExam(ctx: Ctx, input: z.infer<typeof createExamBody>): Promise<ExamDto> {
  const actor = actorOf(ctx);
  try {
    return await inTransaction(ctx.db, async (tx) => {
      await assertUsableCategory(tx, input.categoryId);
      await assertTagsExist(tx, input.tagIds);
      const { tagIds, ...fields } = input;
      const exam = await tx.exam.create({
        data: { ...fields, tags: { create: tagIds.map((tagId) => ({ tagId })) } },
        include: examInclude,
      });
      await audit(tx, {
        action: "catalog.exam_created",
        actorId: actor.userId,
        entityType: "Exam",
        entityId: exam.id,
        detail: { code: exam.code, title: exam.title, categoryId: exam.categoryId, tagIds },
        ip: ctx.ip,
      });
      return examDto(exam);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("An exam with that code already exists.");
    throw err;
  }
}

/**
 * Moving an exam to another category changes who reaches it through category grants, so the
 * caller needs EXAM_EDIT on the destination too (the route already checked the source).
 */
export async function updateExam(ctx: Ctx, examId: string, patch: z.infer<typeof updateExamBody>): Promise<ExamDto> {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.exam.findUnique({ where: { id: examId }, include: examInclude });
    if (!before) throw notFound("Exam not found.");

    if (patch.categoryId !== undefined && patch.categoryId !== before.categoryId) {
      await assertUsableCategory(tx, patch.categoryId);
      if (!authorize(actor, "EXAM_EDIT", { categoryId: patch.categoryId }, ctx.now)) {
        throw new AppError("FORBIDDEN", { message: "You cannot move exams into that category." });
      }
    }

    const exam = await tx.exam.update({ where: { id: examId }, data: patch, include: examInclude });
    await audit(tx, {
      action: "catalog.exam_updated",
      actorId: actor.userId,
      entityType: "Exam",
      entityId: examId,
      detail: { changes: changedFields(examDto(before), examDto(exam), Object.keys(patch)) },
      ip: ctx.ip,
    });
    return examDto(exam);
  });
}

/** Replaces the exam's tag set (idempotent). */
export async function setExamTags(ctx: Ctx, examId: string, tagIds: string[]): Promise<ExamDto> {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.exam.findUnique({ where: { id: examId }, select: { tags: { select: { tagId: true } } } });
    if (!before) throw notFound("Exam not found.");
    await assertTagsExist(tx, tagIds);

    const current = new Set(before.tags.map((t) => t.tagId));
    const added = tagIds.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !tagIds.includes(id));
    if (added.length || removed.length) {
      await tx.examTag.deleteMany({ where: { examId, tagId: { in: removed } } });
      await tx.examTag.createMany({ data: added.map((tagId) => ({ examId, tagId })) });
      await audit(tx, {
        action: "catalog.exam_tags_set",
        actorId: actor.userId,
        entityType: "Exam",
        entityId: examId,
        detail: { added, removed },
        ip: ctx.ip,
      });
    }
    const exam = await tx.exam.findUniqueOrThrow({ where: { id: examId }, include: examInclude });
    return examDto(exam);
  });
}

/** The patched fields that actually changed, as { field: { from, to } } (categoryId as an id). */
function changedFields(before: ExamDto, after: ExamDto, keys: string[]): Prisma.InputJsonObject {
  const flat = (dto: ExamDto) =>
    ({ ...dto, categoryId: dto.category.id }) as unknown as Record<string, Prisma.InputJsonValue>;
  const [from, to] = [flat(before), flat(after)];
  return Object.fromEntries(
    keys.filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k])).map((k) => [k, { from: from[k], to: to[k] }]),
  );
}

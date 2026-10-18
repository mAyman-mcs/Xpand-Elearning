import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation } from "../../core/db.js";
import { conflict, notFound } from "../../core/errors.js";
import { slugify } from "../../core/lib/slug.js";
import { nonBlank } from "../../core/schemas.js";
import type { Category, Tag } from "../../generated/prisma/client.js";

// Categories (one per exam, flat — D1/D2) and tags (cross-cutting labels, admin-managed — D4).

export const categoryBody = z.object({
  name: nonBlank(80),
  position: z.number().int().min(0).max(10_000).default(0),
});
export const categoryPatchBody = z
  .object({ name: nonBlank(80), position: z.number().int().min(0).max(10_000), archived: z.boolean() })
  .partial();
export const tagBody = z.object({ name: nonBlank(50) });

/** Slug from the name; names without Latin letters (e.g. Arabic) get a short random slug. */
function slugFor(name: string): string {
  return slugify(name) || `x-${randomBytes(3).toString("hex")}`;
}

/** Names are unique case-insensitively, and similar names ("Cloud!" vs "Cloud") would share a slug. */
const duplicate = (kind: string) => conflict(`A ${kind} with that name (or a very similar one) already exists.`);

export const categoryDto = (c: Category & { _count?: { exams: number } }) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  position: c.position,
  archived: c.archived,
  ...(c._count ? { examCount: c._count.exams } : {}),
});
export const tagDto = (t: Tag & { _count?: { exams: number; grantScopes: number } }) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  // grantCount > 0 makes it an access tag: only super admins put it on or take it off exams.
  ...(t._count ? { examCount: t._count.exams, grantCount: t._count.grantScopes } : {}),
});

// ───────────────────────────── Categories ─────────────────────────────

export async function listCategories(ctx: Ctx, opts: { includeArchived: boolean }) {
  const rows = await ctx.db.category.findMany({
    where: opts.includeArchived ? {} : { archived: false },
    include: { _count: { select: { exams: true } } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  return rows.map(categoryDto);
}

export async function createCategory(ctx: Ctx, input: z.infer<typeof categoryBody>) {
  try {
    return await inTransaction(ctx.db, async (tx) => {
      const category = await tx.category.create({ data: { ...input, slug: slugFor(input.name) } });
      await audit(tx, {
        action: "catalog.category_created",
        actorId: actorOf(ctx).userId,
        entityType: "Category",
        entityId: category.id,
        detail: { name: category.name },
        ip: ctx.ip,
      });
      return categoryDto(category);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate("category");
    throw err;
  }
}

/** Renaming keeps the slug stable, so links and filters keep working. */
export async function updateCategory(ctx: Ctx, categoryId: string, patch: z.infer<typeof categoryPatchBody>) {
  try {
    return await inTransaction(ctx.db, async (tx) => {
      const before = await tx.category.findUnique({ where: { id: categoryId } });
      if (!before) throw notFound("Category not found.");
      const category = await tx.category.update({ where: { id: categoryId }, data: patch });
      await audit(tx, {
        action: "catalog.category_updated",
        actorId: actorOf(ctx).userId,
        entityType: "Category",
        entityId: categoryId,
        detail: { before: categoryDto(before), after: categoryDto(category) },
        ip: ctx.ip,
      });
      return categoryDto(category);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate("category");
    throw err;
  }
}

/** Only unused categories can be deleted; archive the others (they stay for history). */
export async function deleteCategory(ctx: Ctx, categoryId: string): Promise<void> {
  await inTransaction(ctx.db, async (tx) => {
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      include: { _count: { select: { exams: true } } },
    });
    if (!category) throw notFound("Category not found.");
    if (category._count.exams > 0) {
      throw conflict(`This category has ${category._count.exams} exam(s); archive it instead of deleting it.`);
    }
    await tx.category.delete({ where: { id: categoryId } });
    await audit(tx, {
      action: "catalog.category_deleted",
      actorId: actorOf(ctx).userId,
      entityType: "Category",
      entityId: categoryId,
      detail: { name: category.name },
      ip: ctx.ip,
    });
  });
}

// ──────────────────────────────── Tags ────────────────────────────────

export async function listTags(ctx: Ctx) {
  const rows = await ctx.db.tag.findMany({
    include: { _count: { select: { exams: true, grantScopes: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(tagDto);
}

export async function createTag(ctx: Ctx, input: z.infer<typeof tagBody>) {
  try {
    return await inTransaction(ctx.db, async (tx) => {
      const tag = await tx.tag.create({ data: { name: input.name, slug: slugFor(input.name) } });
      await audit(tx, {
        action: "catalog.tag_created",
        actorId: actorOf(ctx).userId,
        entityType: "Tag",
        entityId: tag.id,
        detail: { name: tag.name },
        ip: ctx.ip,
      });
      return tagDto(tag);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate("tag");
    throw err;
  }
}

export async function renameTag(ctx: Ctx, tagId: string, input: z.infer<typeof tagBody>) {
  try {
    return await inTransaction(ctx.db, async (tx) => {
      const before = await tx.tag.findUnique({ where: { id: tagId } });
      if (!before) throw notFound("Tag not found.");
      const tag = await tx.tag.update({ where: { id: tagId }, data: { name: input.name } });
      await audit(tx, {
        action: "catalog.tag_renamed",
        actorId: actorOf(ctx).userId,
        entityType: "Tag",
        entityId: tagId,
        detail: { from: before.name, to: tag.name },
        ip: ctx.ip,
      });
      return tagDto(tag);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate("tag");
    throw err;
  }
}

/** Deleting a tag removes it from every exam; the audit entry records how many. */
export async function deleteTag(ctx: Ctx, tagId: string): Promise<void> {
  await inTransaction(ctx.db, async (tx) => {
    const tag = await tx.tag.findUnique({
      where: { id: tagId },
      include: { _count: { select: { exams: true, grantScopes: true } } },
    });
    if (!tag) throw notFound("Tag not found.");
    if (tag._count.grantScopes > 0)
      throw conflict(
        `“${tag.name}” gives instructors access (${tag._count.grantScopes} grant${tag._count.grantScopes === 1 ? "" : "s"}); remove it from those grants first.`,
      );
    await tx.tag.delete({ where: { id: tagId } });
    await audit(tx, {
      action: "catalog.tag_deleted",
      actorId: actorOf(ctx).userId,
      entityType: "Tag",
      entityId: tagId,
      detail: { name: tag.name, removedFromExams: tag._count.exams },
      ip: ctx.ip,
    });
  });
}

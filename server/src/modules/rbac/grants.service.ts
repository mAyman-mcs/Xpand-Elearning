import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, type DbClient } from "../../core/db.js";
import { AppError, notFound } from "../../core/errors.js";
import { uuid, uuidList } from "../../core/schemas.js";
import { Permission, type Prisma } from "../../generated/prisma/client.js";
import { isActive } from "./authorize.js";

const grantFields = {
  permissions: z
    .array(z.enum(Permission))
    .min(1)
    .transform((p) => [...new Set(p)]),
  allExams: z.boolean(),
  examIds: uuidList,
  categoryIds: uuidList,
  tagIds: uuidList,
  allGroups: z.boolean(),
  groupIds: uuidList,
  studentsWhoSubmitted: z.boolean(),
  expiresAt: z.iso.datetime().pipe(z.coerce.date()).nullable(),
};

export const grantBody = z.object({
  userId: uuid,
  permissions: grantFields.permissions,
  allExams: grantFields.allExams.default(false),
  examIds: grantFields.examIds.default([]),
  categoryIds: grantFields.categoryIds.default([]),
  tagIds: grantFields.tagIds.default([]),
  allGroups: grantFields.allGroups.default(false),
  groupIds: grantFields.groupIds.default([]),
  studentsWhoSubmitted: grantFields.studentsWhoSubmitted.default(false),
  expiresAt: grantFields.expiresAt.default(null),
});
export type GrantInput = z.infer<typeof grantBody>;

/**
 * PATCH: any field but the grantee; omitted fields keep their value. Built without defaults on
 * purpose — Zod's .partial() keeps .default(), which would silently reset omitted fields.
 */
export const grantPatchBody = z.object(grantFields).partial();
export type GrantPatch = z.infer<typeof grantPatchBody>;

const withScopes = {
  user: { select: { username: true, fullName: true } },
  exams: { select: { examId: true } },
  categories: { select: { categoryId: true } },
  tags: { select: { tagId: true } },
  groups: { select: { groupId: true } },
} satisfies Prisma.InstructorGrantInclude;

type GrantRow = Prisma.InstructorGrantGetPayload<{ include: typeof withScopes }>;

export function grantDto(g: GrantRow, now: Date) {
  return {
    id: g.id,
    userId: g.userId,
    user: g.user,
    permissions: g.permissions,
    allExams: g.allExams,
    examIds: g.exams.map((e) => e.examId),
    categoryIds: g.categories.map((c) => c.categoryId),
    tagIds: g.tags.map((t) => t.tagId),
    allGroups: g.allGroups,
    groupIds: g.groups.map((x) => x.groupId),
    studentsWhoSubmitted: g.studentsWhoSubmitted,
    expiresAt: g.expiresAt,
    active: isActive(g, now),
    createdAt: g.createdAt,
    createdById: g.createdById,
  };
}
export type GrantDto = ReturnType<typeof grantDto>;

const invalid = (path: string, message: string) => new AppError("VALIDATION_FAILED", { details: [{ path, message }] });

/** A grant must be meaningful: an instructor, an exam scope, a student scope, existing ids, a future expiry. */
async function validateGrant(db: DbClient, now: Date, g: Omit<GrantInput, "userId">, userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw invalid("userId", "User not found.");
  if (user.role !== "INSTRUCTOR") throw invalid("userId", "Grants can only be given to instructors.");

  const listsExams = g.examIds.length > 0 || g.categoryIds.length > 0 || g.tagIds.length > 0;
  if (g.allExams === listsExams) {
    throw invalid("allExams", "Choose either all exams, or a list of exams, categories and/or tags.");
  }
  // Exactly one student scope: all groups, listed groups, or students who submitted a covered exam.
  const studentModes = [g.allGroups, g.groupIds.length > 0, g.studentsWhoSubmitted].filter(Boolean).length;
  if (studentModes !== 1) {
    throw invalid(
      "allGroups",
      "Choose exactly one: all groups, a list of groups, or students who submitted these exams.",
    );
  }
  if (g.expiresAt && g.expiresAt <= now) throw invalid("expiresAt", "Expiry must be in the future.");

  const [exams, categories, tags, groups] = await Promise.all([
    db.exam.count({ where: { id: { in: g.examIds } } }),
    db.category.count({ where: { id: { in: g.categoryIds } } }),
    db.tag.count({ where: { id: { in: g.tagIds } } }),
    db.group.count({ where: { id: { in: g.groupIds } } }),
  ]);
  if (exams !== g.examIds.length) throw invalid("examIds", "Some exams do not exist.");
  if (categories !== g.categoryIds.length) throw invalid("categoryIds", "Some categories do not exist.");
  if (tags !== g.tagIds.length) throw invalid("tagIds", "Some tags do not exist.");
  if (groups !== g.groupIds.length) throw invalid("groupIds", "Some groups do not exist.");
}

function scopeRows(g: Omit<GrantInput, "userId">) {
  return {
    exams: { create: g.examIds.map((examId) => ({ examId })) },
    categories: { create: g.categoryIds.map((categoryId) => ({ categoryId })) },
    tags: { create: g.tagIds.map((tagId) => ({ tagId })) },
    groups: { create: g.groupIds.map((groupId) => ({ groupId })) },
  };
}

export async function listGrants(ctx: Ctx, filter: { userId?: string }): Promise<GrantDto[]> {
  const rows = await ctx.db.instructorGrant.findMany({
    where: filter.userId ? { userId: filter.userId } : {},
    include: withScopes,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((g) => grantDto(g, ctx.now));
}

export async function createGrant(ctx: Ctx, input: GrantInput): Promise<GrantDto> {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    await validateGrant(tx, ctx.now, input, input.userId);
    const { examIds: _e, categoryIds: _c, tagIds: _t, groupIds: _g, ...fields } = input;
    const created = await tx.instructorGrant.create({
      data: { ...fields, createdById: actor.userId, ...scopeRows(input) },
      include: withScopes,
    });
    const dto = grantDto(created, ctx.now);
    await audit(tx, {
      action: "rbac.grant_created",
      actorId: actor.userId,
      entityType: "InstructorGrant",
      entityId: created.id,
      detail: snapshot(dto),
      ip: ctx.ip,
    });
    return dto;
  });
}

export async function updateGrant(ctx: Ctx, grantId: string, patch: GrantPatch): Promise<GrantDto> {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const existing = await tx.instructorGrant.findUnique({ where: { id: grantId }, include: withScopes });
    if (!existing) throw notFound("Grant not found.");
    const before = grantDto(existing, ctx.now);
    const merged = {
      permissions: patch.permissions ?? before.permissions,
      allExams: patch.allExams ?? before.allExams,
      examIds: patch.examIds ?? before.examIds,
      categoryIds: patch.categoryIds ?? before.categoryIds,
      tagIds: patch.tagIds ?? before.tagIds,
      allGroups: patch.allGroups ?? before.allGroups,
      groupIds: patch.groupIds ?? before.groupIds,
      studentsWhoSubmitted: patch.studentsWhoSubmitted ?? before.studentsWhoSubmitted,
      expiresAt: patch.expiresAt === undefined ? before.expiresAt : patch.expiresAt,
    };
    await validateGrant(tx, ctx.now, merged, existing.userId);

    // Scope lists are replaced wholesale; simpler and auditable.
    await tx.grantExam.deleteMany({ where: { grantId } });
    await tx.grantCategory.deleteMany({ where: { grantId } });
    await tx.grantTag.deleteMany({ where: { grantId } });
    await tx.grantGroup.deleteMany({ where: { grantId } });
    const { examIds: _e, categoryIds: _c, tagIds: _t, groupIds: _g, ...fields } = merged;
    const updated = await tx.instructorGrant.update({
      where: { id: grantId },
      data: { ...fields, ...scopeRows(merged) },
      include: withScopes,
    });
    const after = grantDto(updated, ctx.now);
    await audit(tx, {
      action: "rbac.grant_updated",
      actorId: actor.userId,
      entityType: "InstructorGrant",
      entityId: grantId,
      detail: { before: snapshot(before), after: snapshot(after) },
      ip: ctx.ip,
    });
    return after;
  });
}

export async function deleteGrant(ctx: Ctx, grantId: string): Promise<void> {
  const actor = actorOf(ctx);
  await inTransaction(ctx.db, async (tx) => {
    const existing = await tx.instructorGrant.findUnique({ where: { id: grantId }, include: withScopes });
    if (!existing) throw notFound("Grant not found.");
    await tx.instructorGrant.delete({ where: { id: grantId } });
    await audit(tx, {
      action: "rbac.grant_deleted",
      actorId: actor.userId,
      entityType: "InstructorGrant",
      entityId: grantId,
      detail: snapshot(grantDto(existing, ctx.now)),
      ip: ctx.ip,
    });
  });
}

/** The audit-relevant part of a grant (JSON-safe). */
function snapshot(g: GrantDto): Prisma.InputJsonObject {
  return {
    userId: g.userId,
    permissions: g.permissions,
    allExams: g.allExams,
    examIds: g.examIds,
    categoryIds: g.categoryIds,
    tagIds: g.tagIds,
    allGroups: g.allGroups,
    groupIds: g.groupIds,
    studentsWhoSubmitted: g.studentsWhoSubmitted,
    expiresAt: g.expiresAt?.toISOString() ?? null,
  };
}

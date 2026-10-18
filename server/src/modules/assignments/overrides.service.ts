import type { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, type DbClient } from "../../core/db.js";
import { conflict, notFound } from "../../core/errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Scope } from "../rbac/authorize.js";
import { reachForExam, reachOf, targetWhere } from "../rbac/scope.js";
import { examTargetScope } from "./assignments.service.js";
import type { createOverrideBody } from "./schemas.js";

// Manual open/close on top of schedules. Ending an override sets validUntil instead of deleting
// it, so the history stays visible (and audited).

export async function overrideScope(db: DbClient, overrideId: string): Promise<Scope> {
  const o = await db.accessOverride.findUnique({ where: { id: overrideId } });
  if (!o) throw notFound("Override not found.");
  return examTargetScope(db, o.examId, { userId: o.userId ?? undefined, groupId: o.groupId ?? undefined });
}

const withTarget = {
  user: { select: { id: true, username: true, fullName: true } },
  group: { select: { id: true, name: true } },
} satisfies Prisma.AccessOverrideInclude;
type OverrideRow = Prisma.AccessOverrideGetPayload<{ include: typeof withTarget }>;

export function overrideDto(o: OverrideRow, now: Date) {
  return {
    id: o.id,
    examId: o.examId,
    target: o.user
      ? { type: "user" as const, id: o.user.id, name: o.user.fullName, username: o.user.username }
      : { type: "group" as const, id: o.group?.id ?? "", name: o.group?.name ?? "" },
    action: o.action,
    validFrom: o.validFrom,
    validUntil: o.validUntil,
    active: o.validFrom <= now && (!o.validUntil || now < o.validUntil),
    reason: o.reason,
    createdAt: o.createdAt,
    createdById: o.createdById,
  };
}

export async function listOverrides(ctx: Ctx, examId: string, includeEnded: boolean) {
  const exam = await ctx.db.exam.findUniqueOrThrow({
    where: { id: examId },
    select: { id: true, categoryId: true, tags: { select: { tagId: true } } },
  });
  const reach = reachForExam(reachOf(actorOf(ctx), "any", ctx.now), { ...exam, tagIds: exam.tags.map((t) => t.tagId) });
  const rows = await ctx.db.accessOverride.findMany({
    where: {
      AND: [
        { examId },
        targetWhere(reach),
        includeEnded ? {} : { OR: [{ validUntil: null }, { validUntil: { gt: ctx.now } }] },
      ],
    },
    include: withTarget,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return rows.map((o) => overrideDto(o, ctx.now));
}

export async function createOverride(ctx: Ctx, input: z.infer<typeof createOverrideBody>) {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const created = await tx.accessOverride.create({
      data: {
        examId: input.examId,
        userId: input.target.userId ?? null,
        groupId: input.target.groupId ?? null,
        action: input.action,
        validFrom: input.validFrom ?? ctx.now,
        validUntil: input.validUntil,
        reason: input.reason,
        createdById: actor.userId,
        createdAt: ctx.now,
      },
      include: withTarget,
    });
    await audit(tx, {
      action: "overrides.created",
      actorId: actor.userId,
      entityType: "AccessOverride",
      entityId: created.id,
      detail: {
        examId: created.examId,
        userId: created.userId,
        groupId: created.groupId,
        action: created.action,
        validFrom: created.validFrom.toISOString(),
        validUntil: created.validUntil?.toISOString() ?? null,
        reason: created.reason,
      },
      ip: ctx.ip,
    });
    return overrideDto(created, ctx.now);
  });
}

export async function endOverride(ctx: Ctx, overrideId: string) {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const existing = await tx.accessOverride.findUnique({ where: { id: overrideId } });
    if (!existing) throw notFound("Override not found.");
    if (existing.validUntil && existing.validUntil <= ctx.now) throw conflict("This override has already ended.");
    const ended = await tx.accessOverride.update({
      where: { id: overrideId },
      data: { validUntil: ctx.now },
      include: withTarget,
    });
    await audit(tx, {
      action: "overrides.ended",
      actorId: actor.userId,
      entityType: "AccessOverride",
      entityId: overrideId,
      detail: { examId: existing.examId, action: existing.action },
      ip: ctx.ip,
    });
    return overrideDto(ended, ctx.now);
  });
}

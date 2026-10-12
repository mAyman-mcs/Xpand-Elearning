import { z } from "zod";
import type { Ctx } from "../../core/context.js";
import { uuid } from "../../core/schemas.js";
import type { Prisma } from "../../generated/prisma/client.js";

// ─────────────────────────────── Dashboard numbers ───────────────────────────────

/** Counts for the super admin's dashboard (docs/ADMIN_DASHBOARD_PLAN.md BE-1). Read-only, not audited. */
export async function adminStats(ctx: Ctx, idleMinutes: number) {
  const { db, now } = ctx;
  const idleSince = new Date(now.getTime() - idleMinutes * 60_000);
  const [roles, inactive, locked, groups, exams, assignments, activeOverrides, activeSessions] = await Promise.all([
    db.user.groupBy({ by: ["role"], where: { isActive: true }, _count: { _all: true } }),
    db.user.count({ where: { isActive: false } }),
    db.user.count({ where: { isActive: true, lockedUntil: { gt: now } } }),
    db.group.count(),
    db.exam.groupBy({ by: ["status"], _count: { _all: true } }),
    db.assignment.count(),
    db.accessOverride.count({
      where: { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
    }),
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: idleSince } } }),
  ]);
  const role = (r: string) => roles.find((x) => x.role === r)?._count._all ?? 0;
  const status = (s: string) => exams.find((x) => x.status === s)?._count._all ?? 0;
  return {
    users: {
      students: role("STUDENT"),
      instructors: role("INSTRUCTOR"),
      admins: role("SUPER_ADMIN"),
      inactive,
      locked,
    },
    groups,
    exams: { draft: status("DRAFT"), published: status("PUBLISHED"), archived: status("ARCHIVED") },
    assignments,
    activeOverrides,
    activeSessions,
  };
}

// ─────────────────────────────── Audit log ───────────────────────────────

export const auditQuery = z
  .object({
    actorId: uuid.optional(),
    /** An exact action ("users.created"), or a prefix ending in "." ("users."). */
    action: z.string().trim().max(100).optional(),
    entityType: z.string().trim().max(50).optional(),
    entityId: z.string().trim().max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    /** The id of the last entry of the previous page (ids are increasing integers). */
    cursor: z
      .string()
      .regex(/^\d{1,19}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to), {
    path: ["to"],
    message: "Must be after `from`",
  });
export type AuditQuery = z.infer<typeof auditQuery>;

/** Newest first, cursor-paginated. Reading the log is not itself audited. */
export async function listAudit(ctx: Ctx, q: AuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.action ? { action: q.action.endsWith(".") ? { startsWith: q.action } : q.action } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.from || q.to
      ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
      : {}),
    ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
  };
  const rows = await ctx.db.auditLog.findMany({
    where,
    include: { actor: { select: { id: true, username: true, fullName: true } } },
    orderBy: { id: "desc" },
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  return {
    items: items.map((a) => {
      // Free-form JSON written by each action: typed as unknown for clients (contracts.AuditEntry).
      const detail: unknown = a.detail;
      return {
        id: a.id.toString(),
        at: a.at,
        actor: a.actor,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        detail,
        ip: a.ip,
      };
    }),
    nextCursor: hasMore ? (items.at(-1)?.id.toString() ?? null) : null,
  };
}

/** The distinct actions in the log, for the filter. */
export async function auditActions(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } });
  return rows.map((r) => r.action);
}

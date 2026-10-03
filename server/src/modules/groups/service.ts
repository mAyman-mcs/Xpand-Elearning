import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { dateOnly, formatDateOnly } from "../../core/dates.js";
import { inTransaction, isUniqueViolation } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { nonBlank, uuidList } from "../../core/schemas.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { groupWhere, reachOf } from "../rbac/scope.js";

export const groupBody = z.object({ name: nonBlank(100), intakeStartDate: dateOnly });
export const groupPatchBody = groupBody.partial();
export const addMembersBody = z.object({
  userIds: uuidList.pipe(z.array(z.uuid()).min(1)),
  joinDate: dateOnly.nullable().default(null),
});
export const memberPatchBody = z.object({ joinDate: dateOnly.nullable() });

const withCount = { _count: { select: { members: true } } } satisfies Prisma.GroupInclude;
type GroupRow = Prisma.GroupGetPayload<{ include: typeof withCount }>;

export function groupDto(g: GroupRow) {
  return { id: g.id, name: g.name, intakeStartDate: formatDateOnly(g.intakeStartDate), memberCount: g._count.members };
}
export type GroupDto = ReturnType<typeof groupDto>;

function visibleGroups(ctx: Ctx): Prisma.GroupWhereInput {
  const actor = actorOf(ctx);
  return actor.role === "SUPER_ADMIN" ? {} : groupWhere(reachOf(actor, "any", ctx.now));
}

export async function listGroups(ctx: Ctx): Promise<GroupDto[]> {
  const rows = await ctx.db.group.findMany({
    where: visibleGroups(ctx),
    include: withCount,
    orderBy: [{ intakeStartDate: "desc" }, { name: "asc" }],
  });
  return rows.map(groupDto);
}

export async function getGroup(ctx: Ctx, groupId: string) {
  const group = await ctx.db.group.findFirst({
    where: { AND: [{ id: groupId }, visibleGroups(ctx)] },
    include: {
      ...withCount,
      members: {
        include: { user: { select: { id: true, username: true, fullName: true, isActive: true } } },
        orderBy: { user: { fullName: "asc" } },
      },
    },
  });
  if (!group) throw notFound("Group not found.");
  return {
    ...groupDto(group),
    members: group.members.map((m) => ({
      ...m.user,
      joinDate: formatDateOnly(m.joinDate),
      // The anchor for join-date-relative schedules (late joiners override the intake date).
      effectiveJoinDate: formatDateOnly(m.joinDate ?? group.intakeStartDate),
    })),
  };
}

async function auditGroup(
  ctx: Ctx,
  tx: Prisma.TransactionClient,
  action: string,
  groupId: string,
  detail: Prisma.InputJsonObject,
) {
  await audit(tx, { action, actorId: actorOf(ctx).userId, entityType: "Group", entityId: groupId, detail, ip: ctx.ip });
}

const nameTaken = () => conflict("A group with that name already exists.");

export async function createGroup(ctx: Ctx, input: z.infer<typeof groupBody>): Promise<GroupDto> {
  try {
    return await inTransaction(ctx.db, async (tx) => {
      const group = await tx.group.create({ data: input, include: withCount });
      await auditGroup(ctx, tx, "groups.created", group.id, {
        name: group.name,
        intakeStartDate: formatDateOnly(group.intakeStartDate),
      });
      return groupDto(group);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

export async function updateGroup(ctx: Ctx, groupId: string, patch: z.infer<typeof groupPatchBody>): Promise<GroupDto> {
  try {
    return await inTransaction(ctx.db, async (tx) => {
      const before = await tx.group.findUnique({ where: { id: groupId } });
      if (!before) throw notFound("Group not found.");
      const group = await tx.group.update({ where: { id: groupId }, data: patch, include: withCount });
      await auditGroup(ctx, tx, "groups.updated", groupId, {
        before: { name: before.name, intakeStartDate: formatDateOnly(before.intakeStartDate) },
        after: { name: group.name, intakeStartDate: formatDateOnly(group.intakeStartDate) },
      });
      return groupDto(group);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

/** Adds students (or updates their join date when already members). */
export async function addMembers(ctx: Ctx, groupId: string, input: z.infer<typeof addMembersBody>) {
  await inTransaction(ctx.db, async (tx) => {
    if (!(await tx.group.findUnique({ where: { id: groupId }, select: { id: true } })))
      throw notFound("Group not found.");
    const students = await tx.user.count({ where: { id: { in: input.userIds }, role: "STUDENT" } });
    if (students !== input.userIds.length) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ path: "userIds", message: "Every member must be an existing student." }],
      });
    }
    for (const userId of input.userIds) {
      await tx.groupMember.upsert({
        where: { userId_groupId: { userId, groupId } },
        create: { userId, groupId, joinDate: input.joinDate },
        update: { joinDate: input.joinDate },
      });
    }
    await auditGroup(ctx, tx, "groups.members_added", groupId, {
      userIds: input.userIds,
      joinDate: formatDateOnly(input.joinDate),
    });
  });
  return getGroup(ctx, groupId);
}

export async function updateMember(ctx: Ctx, groupId: string, userId: string, patch: z.infer<typeof memberPatchBody>) {
  await inTransaction(ctx.db, async (tx) => {
    const member = await tx.groupMember.findUnique({ where: { userId_groupId: { userId, groupId } } });
    if (!member) throw notFound("Member not found.");
    await tx.groupMember.update({ where: { userId_groupId: { userId, groupId } }, data: patch });
    await auditGroup(ctx, tx, "groups.member_updated", groupId, {
      userId,
      joinDate: { from: formatDateOnly(member.joinDate), to: formatDateOnly(patch.joinDate) },
    });
  });
  return getGroup(ctx, groupId);
}

export async function removeMember(ctx: Ctx, groupId: string, userId: string): Promise<void> {
  await inTransaction(ctx.db, async (tx) => {
    const removed = await tx.groupMember.deleteMany({ where: { userId, groupId } });
    if (removed.count === 0) throw notFound("Member not found.");
    await auditGroup(ctx, tx, "groups.member_removed", groupId, { userId });
  });
}

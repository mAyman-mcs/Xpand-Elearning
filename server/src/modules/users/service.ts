import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { dateOnly, formatDateOnly } from "../../core/dates.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { tempPassword } from "../../core/lib/tokens.js";
import { pageArgs, toPage, type Page, type PageQuery } from "../../core/pagination.js";
import { nonBlank, queryBoolean, uuid, uuidList } from "../../core/schemas.js";
import { Role, type Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "../auth/password.js";
import { revokeAllSessions } from "../auth/session.js";
import { reachOf, studentWhere } from "../rbac/scope.js";

export const userListQuery = z.object({
  role: z.enum(Role).optional(),
  groupId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  includeInactive: queryBoolean(false),
});

export const createUserBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, "3-50 characters: a-z 0-9 . _ -"),
  fullName: nonBlank(200),
  email: z.email().nullable().default(null),
  mobile: z.string().trim().max(30).nullable().default(null),
  role: z.enum(Role).default("STUDENT"),
  joinDate: dateOnly.nullable().default(null),
  groupIds: uuidList.default([]),
});

export const updateUserBody = z
  .object({
    fullName: nonBlank(200),
    email: z.email().nullable(),
    mobile: z.string().trim().max(30).nullable(),
    role: z.enum(Role),
    isActive: z.boolean(),
    joinDate: dateOnly.nullable(),
  })
  .partial();

const withGroups = {
  memberships: { include: { group: { select: { id: true, name: true } } } },
} satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof withGroups }>;

export function userDto(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    mobile: u.mobile,
    role: u.role,
    isActive: u.isActive,
    lockedUntil: u.lockedUntil,
    mustChangePassword: u.mustChangePassword,
    joinDate: formatDateOnly(u.joinDate),
    groups: u.memberships.map((m) => ({ id: m.group.id, name: m.group.name, joinDate: formatDateOnly(m.joinDate) })),
    createdAt: u.createdAt,
  };
}
export type UserDto = ReturnType<typeof userDto>;

/** Super admins see everyone; instructors only students reachable through their grants. */
function visibleUsers(ctx: Ctx): Prisma.UserWhereInput {
  const actor = actorOf(ctx);
  return actor.role === "SUPER_ADMIN" ? {} : studentWhere(reachOf(actor, "any", ctx.now));
}

export async function listUsers(
  ctx: Ctx,
  filter: z.infer<typeof userListQuery>,
  page: PageQuery,
): Promise<Page<UserDto>> {
  const where: Prisma.UserWhereInput = {
    AND: [
      visibleUsers(ctx),
      filter.role ? { role: filter.role } : {},
      filter.groupId ? { memberships: { some: { groupId: filter.groupId } } } : {},
      filter.includeInactive ? {} : { isActive: true },
      filter.q
        ? {
            OR: [
              { username: { contains: filter.q, mode: "insensitive" } },
              { fullName: { contains: filter.q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const rows = await ctx.db.user.findMany({
    where,
    include: withGroups,
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    ...pageArgs(page),
  });
  return toPage(rows, page, userDto);
}

export async function getUser(ctx: Ctx, userId: string): Promise<UserDto> {
  const user = await ctx.db.user.findFirst({
    where: { AND: [{ id: userId }, visibleUsers(ctx)] },
    include: withGroups,
  });
  if (!user) throw notFound("User not found.");
  return userDto(user);
}

async function assertGroupsExist(db: DbClient, groupIds: string[]) {
  const found = await db.group.count({ where: { id: { in: groupIds } } });
  if (found !== groupIds.length) {
    throw new AppError("VALIDATION_FAILED", { details: [{ path: "groupIds", message: "Some groups do not exist." }] });
  }
}

export async function createUser(
  ctx: Ctx,
  bcryptCost: number,
  input: z.infer<typeof createUserBody>,
): Promise<{ user: UserDto; temporaryPassword: string }> {
  const actor = actorOf(ctx);
  const temporaryPassword = tempPassword();
  const passwordHash = await hashPassword(temporaryPassword, bcryptCost);
  try {
    return await inTransaction(ctx.db, async (tx) => {
      await assertGroupsExist(tx, input.groupIds);
      const { groupIds, ...fields } = input;
      const user = await tx.user.create({
        data: {
          ...fields,
          passwordHash,
          mustChangePassword: true,
          memberships: { create: groupIds.map((groupId) => ({ groupId })) },
        },
        include: withGroups,
      });
      await audit(tx, {
        action: "users.created",
        actorId: actor.userId,
        entityType: "User",
        entityId: user.id,
        detail: { username: user.username, role: user.role, groupIds },
        ip: ctx.ip,
      });
      return { user: userDto(user), temporaryPassword };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That username is already taken.");
    throw err;
  }
}

export async function updateUser(ctx: Ctx, userId: string, patch: z.infer<typeof updateUserBody>): Promise<UserDto> {
  const actor = actorOf(ctx);
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId }, include: withGroups });
    if (!before) throw notFound("User not found.");

    const roleChanges = patch.role !== undefined && patch.role !== before.role;
    const deactivates = patch.isActive === false && before.isActive;
    // Only active super admins reach this function, so refusing self-changes is enough to
    // guarantee at least one active super admin always remains.
    if ((roleChanges || deactivates) && userId === actor.userId) {
      throw conflict("You cannot change your own role or deactivate yourself.");
    }

    const updated = await tx.user.update({ where: { id: userId }, data: patch, include: withGroups });
    // A new role or a deactivation takes effect immediately: end every session.
    if (roleChanges || deactivates) await revokeAllSessions(tx, userId, ctx.now);

    await audit(tx, {
      action: "users.updated",
      actorId: actor.userId,
      entityType: "User",
      entityId: userId,
      detail: { changes: changedFields(userDto(before), userDto(updated)) },
      ip: ctx.ip,
    });
    return userDto(updated);
  });
}

export async function resetPassword(
  ctx: Ctx,
  bcryptCost: number,
  userId: string,
): Promise<{ temporaryPassword: string }> {
  const actor = actorOf(ctx);
  const temporaryPassword = tempPassword();
  const passwordHash = await hashPassword(temporaryPassword, bcryptCost);
  await inTransaction(ctx.db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw notFound("User not found.");
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    await revokeAllSessions(tx, userId, ctx.now);
    await audit(tx, {
      action: "users.password_reset",
      actorId: actor.userId,
      entityType: "User",
      entityId: userId,
      ip: ctx.ip,
    });
  });
  return { temporaryPassword };
}

function changedFields(before: UserDto, after: UserDto): Prisma.InputJsonObject {
  const keys = ["fullName", "email", "mobile", "role", "isActive", "joinDate"] as const;
  return Object.fromEntries(
    keys.filter((k) => before[k] !== after[k]).map((k) => [k, { from: before[k], to: after[k] }]),
  );
}

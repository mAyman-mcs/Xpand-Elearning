import { auditBestEffort } from "../../core/audit.js";
import type { Ctx } from "../../core/context.js";
import { AppError } from "../../core/errors.js";
import type { Session, User } from "../../generated/prisma/client.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password.js";
import { createSession, revokeAllSessions, revokeSession, type SessionSettings } from "./session.js";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface AuthSettings extends SessionSettings {
  bcryptCost: number;
}

/** The only user fields the browser ever sees. */
export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    mobile: u.mobile,
    role: u.role,
    mustChangePassword: u.mustChangePassword,
  };
}

export async function login(
  ctx: Ctx,
  settings: AuthSettings,
  input: { username: string; password: string; userAgent?: string },
): Promise<{ user: User; token: string }> {
  const { db, now, logger, ip } = ctx;
  const user = await db.user.findUnique({ where: { username: input.username } });

  if (user?.lockedUntil && user.lockedUntil > now) {
    await auditBestEffort(db, logger, { action: "auth.login_locked", actorId: user.id, ip });
    throw new AppError("ACCOUNT_LOCKED", { details: { retryAfter: user.lockedUntil } });
  }

  // Always run the hash comparison so timing does not reveal whether the username exists.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? null, settings.bcryptCost);

  if (!user || !ok || !user.isActive) {
    if (user) await recordFailedLogin(ctx, user);
    await auditBestEffort(db, logger, {
      action: "auth.login_failed",
      actorId: user?.id ?? null,
      detail: { username: input.username },
      ip,
    });
    // Same error for unknown user, wrong password and deactivated account.
    throw new AppError("INVALID_CREDENTIALS");
  }

  if (user.failedLogins > 0 || user.lockedUntil) {
    await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }
  const { token } = await createSession(db, settings, now, user.id, { ip, userAgent: input.userAgent });
  await auditBestEffort(db, logger, { action: "auth.login", actorId: user.id, ip });
  return { user, token };
}

async function recordFailedLogin(ctx: Ctx, user: User): Promise<void> {
  const failed = user.failedLogins + 1;
  await ctx.db.user.update({
    where: { id: user.id },
    data:
      failed >= MAX_FAILED_LOGINS
        ? { failedLogins: 0, lockedUntil: new Date(ctx.now.getTime() + LOCKOUT_MINUTES * 60_000) }
        : { failedLogins: failed },
  });
}

export async function logout(ctx: Ctx, session: Session): Promise<void> {
  await revokeSession(ctx.db, session.id, ctx.now);
  await auditBestEffort(ctx.db, ctx.logger, { action: "auth.logout", actorId: session.userId, ip: ctx.ip });
}

export async function changePassword(
  ctx: Ctx,
  settings: AuthSettings,
  current: { user: User; session: Session },
  input: { currentPassword: string; newPassword: string },
): Promise<User> {
  const { user, session } = current;
  const cost = settings.bcryptCost;

  if (!(await verifyPassword(input.currentPassword, user.passwordHash, cost))) {
    throw new AppError("WRONG_CURRENT_PASSWORD");
  }
  const policyError = checkPasswordPolicy(input.newPassword, user.username);
  if (policyError) throw new AppError("WEAK_PASSWORD", { message: policyError });
  if (await verifyPassword(input.newPassword, user.passwordHash, cost)) {
    throw new AppError("WEAK_PASSWORD", { message: "New password must differ from the current one." });
  }

  const updated = await ctx.db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword, cost), mustChangePassword: false },
  });
  // Sign out every other device.
  await revokeAllSessions(ctx.db, user.id, ctx.now, session.id);
  await auditBestEffort(ctx.db, ctx.logger, { action: "auth.password_changed", actorId: user.id, ip: ctx.ip });
  return updated;
}

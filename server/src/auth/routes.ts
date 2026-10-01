import { Router, type CookieOptions, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { audit } from "../audit.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { User } from "../generated/prisma/client.js";
import { requireAuth } from "./middleware.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password.js";
import { createSession, revokeAllSessions, revokeSession, SESSION_COOKIE } from "./session.js";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: "strict",
  path: "/",
  maxAge: config.SESSION_MAX_HOURS * 3_600_000,
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "TOO_MANY_ATTEMPTS" },
});

const loginBody = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(200),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

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

function clientInfo(req: Request) {
  return { ip: req.ip, userAgent: req.get("user-agent") };
}

export const authRouter = Router();

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_REQUEST" });
    return;
  }
  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username } });
  const now = new Date();

  if (user?.lockedUntil && user.lockedUntil > now) {
    await audit(req, { action: "auth.login_locked", actorId: user.id });
    res.status(423).json({ error: "ACCOUNT_LOCKED", retryAfter: user.lockedUntil });
    return;
  }

  // Always run the hash comparison so timing does not reveal whether the username exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? null);

  if (!user || !ok || !user.isActive) {
    if (user) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
            : { failedLogins: failed },
      });
    }
    await audit(req, { action: "auth.login_failed", actorId: user?.id ?? null, detail: { username } });
    // Same message for unknown user, wrong password and deactivated account.
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  if (user.failedLogins > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  }

  const { ip, userAgent } = clientInfo(req);
  const { token } = await createSession(user.id, ip, userAgent);
  await audit(req, { action: "auth.login", actorId: user.id });

  res.cookie(SESSION_COOKIE, token, cookieOptions);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", async (req, res) => {
  if (req.auth) {
    await revokeSession(req.auth.session.id);
    await audit(req, { action: "auth.logout" });
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

authRouter.get("/me", requireAuth({ allowPasswordChangePending: true }), (req, res) => {
  res.json({ user: publicUser(req.auth!.user) });
});

authRouter.post("/change-password", requireAuth({ allowPasswordChangePending: true }), async (req, res) => {
  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_REQUEST" });
    return;
  }
  const { user, session } = req.auth!;
  const { currentPassword, newPassword } = parsed.data;

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "WRONG_CURRENT_PASSWORD" });
    return;
  }
  const policyError = checkPasswordPolicy(newPassword, user.username);
  if (policyError) {
    res.status(400).json({ error: "WEAK_PASSWORD", message: policyError });
    return;
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    res.status(400).json({ error: "WEAK_PASSWORD", message: "New password must differ from the current one." });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  // Sign out every other device.
  await revokeAllSessions(user.id, session.id);
  await audit(req, { action: "auth.password_changed" });
  res.json({ user: publicUser(updated) });
});

import { config } from "../config.js";
import { prisma } from "../db.js";
import { hashToken, newToken } from "../lib/tokens.js";
import type { Session, User } from "../generated/prisma/client.js";

export const SESSION_COOKIE = "xp_sid";

// lastSeenAt is written at most this often, to avoid a DB write on every request.
const TOUCH_INTERVAL_MS = 60_000;

export type SessionState = "valid" | "revoked" | "expired" | "idle";

/** Pure session validity check (unit tested). */
export function sessionState(
  s: Pick<Session, "revokedAt" | "expiresAt" | "lastSeenAt">,
  now: Date,
  idleMinutes = config.SESSION_IDLE_MINUTES,
): SessionState {
  if (s.revokedAt) return "revoked";
  if (s.expiresAt <= now) return "expired";
  if (now.getTime() - s.lastSeenAt.getTime() > idleMinutes * 60_000) return "idle";
  return "valid";
}

export async function createSession(userId: string, ip?: string, userAgent?: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.SESSION_MAX_HOURS * 3_600_000);
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, ip, userAgent: userAgent?.slice(0, 500) },
  });
  return { token, session };
}

/** Resolves a cookie token to an active session and user, sliding the idle timer. */
export async function resolveSession(token: string): Promise<{ session: Session; user: User } | null> {
  const found = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!found) return null;

  const now = new Date();
  const state = sessionState(found, now);
  if (state !== "valid" || !found.user.isActive) {
    if (state === "idle" || !found.user.isActive) {
      await prisma.session.update({ where: { id: found.id }, data: { revokedAt: now } });
    }
    return null;
  }

  if (now.getTime() - found.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: found.id }, data: { lastSeenAt: now } });
  }
  const { user, ...session } = found;
  return { session, user };
}

export function revokeSession(sessionId: string) {
  return prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

export function revokeAllSessions(userId: string, exceptSessionId?: string) {
  return prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

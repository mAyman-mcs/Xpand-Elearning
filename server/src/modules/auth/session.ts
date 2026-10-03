import type { DbClient } from "../../core/db.js";
import { hashToken, newToken } from "../../core/lib/tokens.js";
import type { Session, User } from "../../generated/prisma/client.js";

export const SESSION_COOKIE = "xp_sid";

// lastSeenAt is written at most this often, to avoid a DB write on every request.
const TOUCH_INTERVAL_MS = 60_000;

export interface SessionSettings {
  idleMinutes: number;
  maxHours: number;
}

export type SessionState = "valid" | "revoked" | "expired" | "idle";

/** Pure session validity check. */
export function sessionState(
  s: Pick<Session, "revokedAt" | "expiresAt" | "lastSeenAt">,
  now: Date,
  idleMinutes: number,
): SessionState {
  if (s.revokedAt) return "revoked";
  if (s.expiresAt <= now) return "expired";
  if (now.getTime() - s.lastSeenAt.getTime() > idleMinutes * 60_000) return "idle";
  return "valid";
}

export async function createSession(
  db: DbClient,
  settings: SessionSettings,
  now: Date,
  userId: string,
  client: { ip?: string; userAgent?: string },
) {
  const token = newToken();
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + settings.maxHours * 3_600_000),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 500),
    },
  });
  return { token, session };
}

/** Resolves a cookie token to an active session and user, sliding the idle timer. */
export async function resolveSession(
  db: DbClient,
  settings: SessionSettings,
  now: Date,
  token: string,
): Promise<{ session: Session; user: User } | null> {
  const found = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!found) return null;

  const state = sessionState(found, now, settings.idleMinutes);
  if (state !== "valid" || !found.user.isActive) {
    if (state === "idle" || (state === "valid" && !found.user.isActive)) {
      await db.session.update({ where: { id: found.id }, data: { revokedAt: now } });
    }
    return null;
  }

  if (now.getTime() - found.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: found.id }, data: { lastSeenAt: now } });
  }
  const { user, ...session } = found;
  return { session, user };
}

export function revokeSession(db: DbClient, sessionId: string, now: Date) {
  return db.session.update({ where: { id: sessionId }, data: { revokedAt: now } });
}

export function revokeAllSessions(db: DbClient, userId: string, now: Date, exceptSessionId?: string) {
  return db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: now },
  });
}

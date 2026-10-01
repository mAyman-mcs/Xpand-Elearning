import type { NextFunction, Request, RequestHandler, Response } from "express";
import { prisma } from "../db.js";
import type { Permission, Role, Session, User } from "../generated/prisma/client.js";
import { authorize, type Principal, type Scope } from "../rbac/authorize.js";
import { resolveSession, SESSION_COOKIE } from "./session.js";

declare global {
  namespace Express {
    interface Request {
      auth?: { user: User; session: Session; principal?: Principal };
    }
  }
}

/** Attaches req.auth when the session cookie is valid. Does not reject anonymous requests. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token.length > 0) {
    const resolved = await resolveSession(token);
    if (resolved) req.auth = resolved;
  }
  next();
};

/**
 * Blocks cross-site form posts: state-changing API calls must be JSON, which a foreign page
 * cannot send without a CORS preflight (and we allow no cross-origin requests).
 * Works together with the SameSite=Strict session cookie.
 */
export const requireJsonForWrites: RequestHandler = (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.is("application/json")) {
    res.status(415).json({ error: "UNSUPPORTED_MEDIA_TYPE" });
    return;
  }
  next();
};

interface RequireAuthOptions {
  /** Let users who still have to change their temporary password through. */
  allowPasswordChangePending?: boolean;
}

export function requireAuth(opts: RequireAuthOptions = {}): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: "UNAUTHENTICATED" });
      return;
    }
    if (req.auth.user.mustChangePassword && !opts.allowPasswordChangePending) {
      res.status(403).json({ error: "PASSWORD_CHANGE_REQUIRED" });
      return;
    }
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.user.role)) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    next();
  };
}

/** Loads (once per request) the caller's role and grants. */
export async function getPrincipal(req: Request): Promise<Principal> {
  const auth = req.auth;
  if (!auth) throw new Error("getPrincipal called without authentication");
  if (auth.principal) return auth.principal;

  const grants =
    auth.user.role === "INSTRUCTOR"
      ? await prisma.instructorGrant.findMany({
          where: { userId: auth.user.id },
          include: { exams: { select: { examId: true } }, groups: { select: { groupId: true } } },
        })
      : [];

  auth.principal = {
    userId: auth.user.id,
    role: auth.user.role,
    grants: grants.map((g) => ({
      permissions: g.permissions,
      allExams: g.allExams,
      allGroups: g.allGroups,
      examIds: g.exams.map((e) => e.examId),
      groupIds: g.groups.map((x) => x.groupId),
      expiresAt: g.expiresAt,
    })),
  };
  return auth.principal;
}

/**
 * Route guard for a scoped permission. `scopeOf` extracts the exam/group the request touches
 * (typically from route params); use it after requireAuth().
 */
export function requirePermission(
  permission: Permission,
  scopeOf: (req: Request) => Scope | Promise<Scope> = () => ({}),
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const principal = await getPrincipal(req);
    if (!authorize(principal, permission, await scopeOf(req))) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    next();
  };
}

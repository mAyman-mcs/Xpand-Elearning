import type { CookieOptions, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authOf, type AppDeps, type RouteContext } from "../../core/context.js";
import { access, ApiRouter } from "../../core/route.js";
import { changePassword, login, logout, publicUser, type AuthSettings } from "./service.js";
import { resolveSession, SESSION_COOKIE } from "./session.js";

const loginBody = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(200),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export function authSettings(deps: AppDeps): AuthSettings {
  return {
    bcryptCost: deps.config.BCRYPT_COST,
    idleMinutes: deps.config.SESSION_IDLE_MINUTES,
    maxHours: deps.config.SESSION_MAX_HOURS,
  };
}

/** Attaches req.auth when the session cookie is valid. Never rejects; access checks happen per route. */
export function sessionLoader(deps: AppDeps): RequestHandler {
  const settings = authSettings(deps);
  return async (req, _res, next) => {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token.length > 0) {
      const resolved = await resolveSession(deps.db, settings, deps.clock(), token);
      if (resolved) req.auth = resolved;
    }
    next();
  };
}

export function authRoutes(deps: AppDeps): ApiRouter {
  const settings = authSettings(deps);
  const api = new ApiRouter(deps);

  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: deps.config.COOKIE_SECURE,
    sameSite: "strict",
    path: "/",
    maxAge: settings.maxHours * 3_600_000,
  };
  const clearCookie = (ctx: RouteContext) =>
    ctx.res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });

  // Per app instance, so each test app starts with a fresh counter.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: deps.config.LOGIN_RATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "TOO_MANY_ATTEMPTS" },
  });

  api.post("/login", {
    access: access.public(),
    before: [loginLimiter],
    body: loginBody,
    handler: async (ctx, { body }) => {
      const { user, token } = await login(ctx, settings, { ...body, userAgent: ctx.req.get("user-agent") });
      ctx.res.cookie(SESSION_COOKIE, token, cookieOptions);
      return { user: publicUser(user) };
    },
  });

  api.post("/logout", {
    access: access.public(),
    handler: async (ctx) => {
      if (ctx.auth) await logout(ctx, ctx.auth.session);
      clearCookie(ctx);
    },
  });

  api.get("/me", {
    access: access.authenticated({ allowPasswordChangePending: true }),
    handler: (ctx) => ({ user: publicUser(authOf(ctx).user) }),
  });

  api.post("/change-password", {
    access: access.authenticated({ allowPasswordChangePending: true }),
    body: changePasswordBody,
    handler: async (ctx, { body }) => {
      const updated = await changePassword(ctx, settings, authOf(ctx), body);
      return { user: publicUser(updated) };
    },
  });

  return api;
}

import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { Session, User } from "../generated/prisma/client.js";
import type { Principal } from "../modules/rbac/authorize.js";
import type { Config } from "./config.js";
import type { Db, DbClient } from "./db.js";

/** Everything the app is built from. Tests pass their own (test database, fixed clock, silent logger). */
export interface AppDeps {
  config: Config;
  db: Db;
  logger: Logger;
  clock: () => Date;
}

/** What a service needs: data access, the time, and who is acting. */
export interface Ctx {
  db: DbClient;
  now: Date;
  actor: Principal | null;
  ip?: string;
  logger: Logger;
}

export interface AuthState {
  user: User;
  session: Session;
}

/** A Ctx plus the HTTP-level pieces route handlers occasionally need (cookies). */
export interface RouteContext extends Ctx {
  db: Db;
  config: Config;
  auth: AuthState | null;
  req: Request;
  res: Response;
}

declare global {
  // Module augmentation of Express request typing requires the namespace form.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthState;
    }
  }
}

/** The acting principal, or an error when called on an anonymous context (a programming mistake). */
export function actorOf(ctx: Ctx): Principal {
  if (!ctx.actor) throw new Error("this operation requires an authenticated actor");
  return ctx.actor;
}

/** The authenticated user and session; only valid on routes whose access policy requires login. */
export function authOf(ctx: RouteContext): AuthState {
  if (!ctx.auth) throw new Error("authOf called on a route without authentication");
  return ctx.auth;
}

import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Permission, Role } from "../generated/prisma/client.js";
import { authorize, canSeeAnything, type Principal, type Scope } from "../modules/rbac/authorize.js";
import { loadPrincipal } from "../modules/rbac/principal.js";
import { actorOf, type AppDeps, type RouteContext } from "./context.js";
import { AppError } from "./errors.js";

// ───────────────────────────── Access policies ─────────────────────────────

export type Access =
  | { kind: "public" }
  | { kind: "authenticated"; allowPasswordChangePending?: boolean }
  | { kind: "roles"; roles: Role[] }
  | { kind: "permission"; permissions: readonly Permission[] | typeof ANY_PERMISSION };

/** Read access: any staff permission that reaches the scope (e.g. viewing an exam). */
export const ANY_PERMISSION = "ANY_PERMISSION";

/** Readable constructors: `access: access.permission("EXAM_ASSIGN"), scope: (ctx, { params }) => examScope(ctx.db, params.examId)`. */
export const access = {
  public: (): Access => ({ kind: "public" }),
  authenticated: (opts: { allowPasswordChangePending?: boolean } = {}): Access => ({ kind: "authenticated", ...opts }),
  roles: (...roles: Role[]): Access => ({ kind: "roles", roles }),
  /** Any one of the listed permissions is enough. */
  permission: (...permissions: [Permission, ...Permission[]]): Access => ({ kind: "permission", permissions }),
  anyPermission: (): Access => ({ kind: "permission", permissions: ANY_PERMISSION }),
};

/** Marks a handler with its policy so the route-coverage test can prove every route declares one. */
export const POLICY = Symbol("route-policy");
type PolicyTagged = RequestHandler & { [POLICY]?: Access };

/** For the few routes registered outside ApiRouter (static files, SPA fallback). */
export function publicHandler(handler: RequestHandler): RequestHandler {
  (handler as PolicyTagged)[POLICY] = { kind: "public" };
  return handler;
}

// ──────────────────────────────── Replies ────────────────────────────────

export class Reply {
  constructor(
    readonly status: number,
    readonly body?: unknown,
  ) {}
}
export const created = (body: unknown) => new Reply(201, body);
export const noContent = () => new Reply(204);

// ──────────────────────────────── Routes ────────────────────────────────

const empty = z.object({});
type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type Schema = z.ZodType;

export interface RouteSpec<P extends Schema, Q extends Schema, B extends Schema> {
  params?: P;
  query?: Q;
  body?: B;
  access: Access;
  /**
   * For permission routes: which exam / category / groups the request touches. Throw NOT_FOUND
   * when the target does not exist. Omit for unscoped actions (then list queries must use scopeFilter).
   */
  scope?: (ctx: RouteContext, input: Input<P, Q, B>) => Scope | Promise<Scope>;
  /** Extra middleware run before access checks (e.g. a rate limiter). */
  before?: RequestHandler[];
  /** Return data (200), a Reply (custom status), or nothing (204). Throw AppError for failures. */
  handler: (ctx: RouteContext, input: Input<P, Q, B>) => unknown;
}

export interface Input<P extends Schema, Q extends Schema, B extends Schema> {
  params: z.infer<P>;
  query: z.infer<Q>;
  body: z.infer<B>;
}

/**
 * The only way API routes are registered. Each route states its access policy and input
 * schemas next to its handler; the router enforces both before the handler runs.
 */
export class ApiRouter {
  readonly router = Router();
  /** Every route registered here, with its policy (for the route table and coverage tests). */
  readonly routes: { method: HttpMethod; path: string; access: Access }[] = [];

  constructor(private readonly deps: AppDeps) {}

  get<P extends Schema = typeof empty, Q extends Schema = typeof empty, B extends Schema = typeof empty>(
    path: string,
    spec: RouteSpec<P, Q, B>,
  ) {
    this.add("get", path, spec);
  }
  post<P extends Schema = typeof empty, Q extends Schema = typeof empty, B extends Schema = typeof empty>(
    path: string,
    spec: RouteSpec<P, Q, B>,
  ) {
    this.add("post", path, spec);
  }
  put<P extends Schema = typeof empty, Q extends Schema = typeof empty, B extends Schema = typeof empty>(
    path: string,
    spec: RouteSpec<P, Q, B>,
  ) {
    this.add("put", path, spec);
  }
  patch<P extends Schema = typeof empty, Q extends Schema = typeof empty, B extends Schema = typeof empty>(
    path: string,
    spec: RouteSpec<P, Q, B>,
  ) {
    this.add("patch", path, spec);
  }
  delete<P extends Schema = typeof empty, Q extends Schema = typeof empty, B extends Schema = typeof empty>(
    path: string,
    spec: RouteSpec<P, Q, B>,
  ) {
    this.add("delete", path, spec);
  }

  private add<P extends Schema, Q extends Schema, B extends Schema>(
    method: HttpMethod,
    path: string,
    spec: RouteSpec<P, Q, B>,
  ) {
    const handler: PolicyTagged = async (req: Request, res: Response) => {
      const ctx = await this.context(req, res, spec.access.kind !== "public");
      // Order matters: who you are, then what you sent, then what it touches — so anonymous callers
      // and students learn nothing about input formats or which ids exist.
      checkIdentity(spec.access, ctx);
      const input = {
        params: (spec.params ?? empty).parse(req.params),
        query: (spec.query ?? empty).parse(req.query),
        body: (spec.body ?? empty).parse(req.body ?? {}),
      } as Input<P, Q, B>;

      if (spec.access.kind === "permission") {
        const scope = spec.scope ? await spec.scope(ctx, input) : {};
        checkPermission(spec.access.permissions, ctx, scope);
      }
      send(res, await spec.handler(ctx, input));
    };
    handler[POLICY] = spec.access;
    this.router[method](path, ...(spec.before ?? []), handler);
    this.routes.push({ method, path, access: spec.access });
  }

  private async context(req: Request, res: Response, needsPrincipal: boolean): Promise<RouteContext> {
    const { db, config, clock } = this.deps;
    const now = clock();
    const auth = req.auth ?? null;
    const actor: Principal | null = auth && needsPrincipal ? await loadPrincipal(db, auth.user) : null;
    return { db, config, now, actor, auth, ip: req.ip, logger: req.log, req, res };
  }
}

/** Authentication, forced password change, and role checks. Permission scope is checked after input parsing. */
function checkIdentity(policy: Access, ctx: RouteContext): void {
  if (policy.kind === "public") return;

  const auth = ctx.auth;
  if (!auth || !ctx.actor) throw new AppError("UNAUTHENTICATED");
  if (auth.user.mustChangePassword && !(policy.kind === "authenticated" && policy.allowPasswordChangePending)) {
    throw new AppError("PASSWORD_CHANGE_REQUIRED");
  }
  if (policy.kind === "roles" && !policy.roles.includes(auth.user.role)) throw new AppError("FORBIDDEN");
  // Staff permissions never apply to students; refuse before any scope lookup touches the database.
  if (policy.kind === "permission" && auth.user.role === "STUDENT") throw new AppError("FORBIDDEN");
}

function checkPermission(
  permissions: readonly Permission[] | typeof ANY_PERMISSION,
  ctx: RouteContext,
  scope: Scope,
): void {
  const actor = actorOf(ctx);
  const allowed =
    permissions === ANY_PERMISSION
      ? canSeeAnything(actor, scope, ctx.now)
      : permissions.some((p) => authorize(actor, p, scope, ctx.now));
  if (allowed) return;
  // Hide resources the caller cannot see at all; say "forbidden" only when they can see it.
  if (Object.keys(scope).length > 0 && !canSeeAnything(actor, scope, ctx.now)) throw new AppError("NOT_FOUND");
  throw new AppError("FORBIDDEN");
}

function send(res: Response, result: unknown): void {
  if (result instanceof Reply) {
    if (result.body === undefined) res.status(result.status).end();
    else res.status(result.status).json(result.body);
  } else if (result === undefined) {
    res.status(204).end();
  } else {
    res.json(result);
  }
}

import type { AppDeps } from "../../core/context.js";
import { access, ApiRouter } from "../../core/route.js";
import { adminStats, auditActions, auditQuery, listAudit } from "./service.js";

/** Mounted at /api/admin: the super admin's dashboard numbers. */
export function adminRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  api.get("/stats", {
    access: access.roles("SUPER_ADMIN"),
    handler: (ctx) => adminStats(ctx, deps.config.SESSION_IDLE_MINUTES),
  });
  return api;
}

/**
 * Mounted at /api/audit: the audit log, read-only. Super admins only for now; instructors with
 * AUDIT_VIEW get a scoped view in phase B9 (docs/NEXT_PLAN.md E18).
 */
export function auditRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const superAdmin = access.roles("SUPER_ADMIN");
  api.get("/", { access: superAdmin, query: auditQuery, handler: (ctx, { query }) => listAudit(ctx, query) });
  api.get("/actions", { access: superAdmin, handler: (ctx) => auditActions(ctx) });
  return api;
}

import type { AppDeps } from "../../core/context.js";
import { access, ApiRouter } from "../../core/route.js";

export function healthRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);

  // The process is up (container liveness).
  api.get("/live", { access: access.public(), handler: () => ({ ok: true }) });

  // The process can serve traffic: the database answers (Docker health check, load balancer).
  api.get("/ready", {
    access: access.public(),
    handler: async (ctx) => {
      await ctx.db.$queryRaw`SELECT 1`;
      return { ok: true };
    },
  });

  return api;
}

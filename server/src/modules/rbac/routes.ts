import { z } from "zod";
import { actorOf, authOf, type AppDeps } from "../../core/context.js";
import { access, ApiRouter, created, noContent } from "../../core/route.js";
import { idParams, uuid } from "../../core/schemas.js";
import { createGrant, deleteGrant, grantBody, grantPatchBody, listGrants, updateGrant } from "./grants.service.js";

/** Grant management: super admins only. Mounted at /api/rbac. */
export function rbacRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const superAdmin = access.roles("SUPER_ADMIN");

  api.get("/grants", {
    access: superAdmin,
    query: z.object({ userId: uuid.optional() }),
    handler: (ctx, { query }) => listGrants(ctx, query),
  });

  api.post("/grants", {
    access: superAdmin,
    body: grantBody,
    handler: async (ctx, { body }) => created(await createGrant(ctx, body)),
  });

  api.patch("/grants/:id", {
    access: superAdmin,
    params: idParams,
    body: grantPatchBody,
    handler: (ctx, { params, body }) => updateGrant(ctx, params.id, body),
  });

  api.delete("/grants/:id", {
    access: superAdmin,
    params: idParams,
    handler: async (ctx, { params }) => {
      await deleteGrant(ctx, params.id);
      return noContent();
    },
  });

  return api;
}

/** The caller's own role and active grants, for the UI to decide what to show. Mounted at /api/me. */
export function meRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);

  api.get("/permissions", {
    access: access.authenticated(),
    handler: async (ctx) => {
      const { user } = authOf(ctx);
      const grants = user.role === "INSTRUCTOR" ? await listGrants(ctx, { userId: actorOf(ctx).userId }) : [];
      return {
        role: user.role,
        grants: grants
          .filter((g) => g.active)
          .map(
            ({
              permissions,
              allExams,
              examIds,
              categoryIds,
              tagIds,
              allGroups,
              groupIds,
              studentsWhoSubmitted,
              expiresAt,
            }) => ({
              permissions,
              allExams,
              examIds,
              categoryIds,
              tagIds,
              allGroups,
              groupIds,
              studentsWhoSubmitted,
              expiresAt,
            }),
          ),
      };
    },
  });

  return api;
}

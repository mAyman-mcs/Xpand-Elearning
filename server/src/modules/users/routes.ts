import type { AppDeps } from "../../core/context.js";
import { pageQuery } from "../../core/pagination.js";
import { access, ApiRouter, created } from "../../core/route.js";
import { idParams } from "../../core/schemas.js";
import {
  createUser,
  createUserBody,
  getUser,
  listUsers,
  resetPassword,
  updateUser,
  updateUserBody,
  userListQuery,
} from "./service.js";

/** Mounted at /api/users. Writes are super-admin only; instructors may look up students in their reach. */
export function usersRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const cost = deps.config.BCRYPT_COST;
  const staff = access.roles("SUPER_ADMIN", "INSTRUCTOR");
  const superAdmin = access.roles("SUPER_ADMIN");

  api.get("/", {
    access: staff,
    query: userListQuery.extend(pageQuery.shape),
    handler: (ctx, { query }) => listUsers(ctx, query, query),
  });

  api.get("/:id", {
    access: staff,
    params: idParams,
    handler: (ctx, { params }) => getUser(ctx, params.id),
  });

  api.post("/", {
    access: superAdmin,
    body: createUserBody,
    handler: async (ctx, { body }) => created(await createUser(ctx, cost, body)),
  });

  api.patch("/:id", {
    access: superAdmin,
    params: idParams,
    body: updateUserBody,
    handler: (ctx, { params, body }) => updateUser(ctx, params.id, body),
  });

  api.post("/:id/reset-password", {
    access: superAdmin,
    params: idParams,
    handler: (ctx, { params }) => resetPassword(ctx, cost, params.id),
  });

  return api;
}

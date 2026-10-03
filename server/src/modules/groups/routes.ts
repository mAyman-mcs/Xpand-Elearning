import { z } from "zod";
import type { AppDeps } from "../../core/context.js";
import { access, ApiRouter, created, noContent } from "../../core/route.js";
import { idParams, uuid } from "../../core/schemas.js";
import {
  addMembers,
  addMembersBody,
  createGroup,
  getGroup,
  groupBody,
  groupPatchBody,
  listGroups,
  memberPatchBody,
  removeMember,
  updateGroup,
  updateMember,
} from "./service.js";

const memberParams = z.object({ id: uuid, userId: uuid });

/** Mounted at /api/groups. Writes are super-admin only; instructors see groups in their reach. */
export function groupsRoutes(deps: AppDeps): ApiRouter {
  const api = new ApiRouter(deps);
  const staff = access.roles("SUPER_ADMIN", "INSTRUCTOR");
  const superAdmin = access.roles("SUPER_ADMIN");

  api.get("/", { access: staff, handler: (ctx) => listGroups(ctx) });

  api.get("/:id", { access: staff, params: idParams, handler: (ctx, { params }) => getGroup(ctx, params.id) });

  api.post("/", {
    access: superAdmin,
    body: groupBody,
    handler: async (ctx, { body }) => created(await createGroup(ctx, body)),
  });

  api.patch("/:id", {
    access: superAdmin,
    params: idParams,
    body: groupPatchBody,
    handler: (ctx, { params, body }) => updateGroup(ctx, params.id, body),
  });

  api.post("/:id/members", {
    access: superAdmin,
    params: idParams,
    body: addMembersBody,
    handler: (ctx, { params, body }) => addMembers(ctx, params.id, body),
  });

  api.patch("/:id/members/:userId", {
    access: superAdmin,
    params: memberParams,
    body: memberPatchBody,
    handler: (ctx, { params, body }) => updateMember(ctx, params.id, params.userId, body),
  });

  api.delete("/:id/members/:userId", {
    access: superAdmin,
    params: memberParams,
    handler: async (ctx, { params }) => {
      await removeMember(ctx, params.id, params.userId);
      return noContent();
    },
  });

  return api;
}

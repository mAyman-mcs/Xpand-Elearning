import type { Express } from "express";
import request from "supertest";
import type { Actor, World } from "./rbac-world.js";

/**
 * One row of the RBAC endpoint matrix: a request against the seeded world, and the status
 * every actor must get. `expect` is a full Record, so forgetting an actor is a type error.
 */
export interface MatrixRow {
  /** "METHOD /api/path" exactly as in apiRouteTable(), e.g. "PATCH /api/groups/:id". */
  route: string;
  /** Optional label when one route has several rows (e.g. in-scope vs out-of-scope target). */
  label?: string;
  request: (w: World) => { path: string; body?: object };
  expect: Record<Actor, number>;
}

/** Shorthand: every actor gets `base`, except the ones listed. */
export function statuses(base: number, overrides: Partial<Record<Actor, number>> = {}): Record<Actor, number> {
  return {
    superAdmin: base,
    student: base,
    instNone: base,
    instExamA: base,
    instCategory: base,
    instSplit: base,
    instExpired: base,
    instTag: base,
    anonymous: 401,
    ...overrides,
  };
}

/** Super admin only: others 403, anonymous 401. */
export const superAdminOnly = (ok: number) => statuses(403, { superAdmin: ok });

export async function runCell(app: Express, w: World, row: MatrixRow, actor: Actor): Promise<request.Response> {
  const agent = request.agent(app);
  if (actor !== "anonymous") {
    const user = w.users[actor];
    const res = await agent.post("/api/auth/login").send({ username: user.username, password: user.password });
    if (res.status !== 200) throw new Error(`login as ${actor} failed: ${res.status}`);
  }
  const { path, body } = row.request(w);
  const method = row.route.split(" ")[0]?.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  const req = agent[method](path);
  return body === undefined && method === "get" ? req : req.send(body ?? {});
}

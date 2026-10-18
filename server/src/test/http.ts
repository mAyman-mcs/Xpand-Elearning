import type { Express } from "express";
import request from "supertest";
import type { TestUser } from "./factories.js";

/** A cookie-keeping supertest agent, logged in as `user`. */
export async function loginAs(app: Express, user: Pick<TestUser, "username" | "password">) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username: user.username, password: user.password });
  if (res.status !== 200)
    throw new Error(`loginAs(${user.username}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export function sessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const first = raw?.[0];
  if (!first) throw new Error("response set no cookie");
  return first.split(";")[0] ?? "";
}

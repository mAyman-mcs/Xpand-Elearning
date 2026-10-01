// Integration tests: need the dev database (docker compose -f docker-compose.dev.yml up -d).
// Run with: npm run test:int -w server
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { prisma } from "../db.js";
import { hashPassword } from "./password.js";

const app = createApp();
const PASSWORD = "Initial-pass-123";

async function reset() {
  // TRUNCATE bypasses the audit log's row-level append-only trigger (test database only).
  await prisma.$executeRawUnsafe(`TRUNCATE "AuditLog", "Session", "GroupMember", "User" CASCADE`);
  await prisma.user.create({
    data: { username: "student1", fullName: "Student One", passwordHash: await hashPassword(PASSWORD) },
  });
}

function login(password = PASSWORD, username = "student1") {
  return request(app).post("/api/auth/login").send({ username, password });
}

function cookieOf(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw[0]!.split(";")[0]!;
}

beforeEach(reset);
afterAll(() => prisma.$disconnect());

describe("auth flow", () => {
  it("returns the same error for unknown users and wrong passwords", async () => {
    const a = await login("nope");
    const b = await login(PASSWORD, "ghost");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("sets an httpOnly SameSite=Strict cookie and never returns the password hash", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const raw = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it("locks the account after 5 failed attempts, even for the right password", async () => {
    for (let i = 0; i < 5; i++) await login("wrong-password");
    const res = await login();
    expect(res.status).toBe(423);
  });

  it("forces a password change, then signs out other sessions", async () => {
    const first = cookieOf(await login());
    const second = cookieOf(await login());

    const weak = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", second)
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(weak.status).toBe(400);

    const ok = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", second)
      .send({ currentPassword: PASSWORD, newPassword: "Brand-new-pass-456" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);

    expect((await request(app).get("/api/auth/me").set("Cookie", second)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", first)).status).toBe(401);
  });

  it("invalidates the session on logout", async () => {
    const cookie = cookieOf(await login());
    await request(app).post("/api/auth/logout").set("Cookie", cookie).set("Content-Type", "application/json").send({});
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("expires idle sessions server-side", async () => {
    const cookie = cookieOf(await login());
    await prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 21 * 60_000) } });
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("rejects non-JSON writes (cross-site form posts)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .type("form")
      .send({ username: "student1", password: PASSWORD });
    expect(res.status).toBe(415);
  });

  it("answers malformed and oversized JSON with client errors, not 500", async () => {
    const bad = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "INVALID_REQUEST" });

    const big = await request(app)
      .post("/api/auth/login")
      .send({ username: "x", password: "y".repeat(200_000) });
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });

  it("omits upgrade-insecure-requests when cookies are not Secure (plain-http test hosts)", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
  });

  it("writes audit entries for logins", async () => {
    await login("nope");
    await login();
    const actions = (await prisma.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["auth.login_failed", "auth.login"]);
  });
});

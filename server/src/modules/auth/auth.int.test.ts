import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeUser, type TestUser } from "../../test/factories.js";
import { loginAs, sessionCookie } from "../../test/http.js";

const { app, db, clock } = createTestApp();
let student: TestUser;

beforeEach(async () => {
  clock.reset();
  await resetDb(db);
  student = await makeUser(db, { username: "student1", mustChangePassword: true });
});
afterAll(() => db.$disconnect());

const login = (password = student.password, username = student.username) =>
  request(app).post("/api/auth/login").send({ username, password });
const me = (cookie: string) => request(app).get("/api/auth/me").set("Cookie", cookie);

describe("login", () => {
  it("returns the same error for unknown users and wrong passwords", async () => {
    const wrong = await login("nope-nope-1");
    const unknown = await login(student.password, "ghost");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual({ error: "INVALID_CREDENTIALS" });
    expect(unknown.body).toEqual(wrong.body);
  });

  it("treats usernames case-insensitively and trims them", async () => {
    expect((await login(student.password, "  STUDENT1 ")).status).toBe(200);
  });

  it("sets an httpOnly SameSite=Strict cookie and never returns the password hash", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const raw = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it("rejects deactivated accounts with the generic error", async () => {
    const inactive = await makeUser(db, { isActive: false });
    const res = await login(inactive.password, inactive.username);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "INVALID_CREDENTIALS" });
  });

  it("locks the account after 5 failures, even for the right password, then unlocks after 15 minutes", async () => {
    for (let i = 0; i < 5; i++) await login("wrong-password-1");
    const locked = await login();
    expect(locked.status).toBe(423);
    expect(locked.body.error).toBe("ACCOUNT_LOCKED");

    clock.advance(16);
    expect((await login()).status).toBe(200);
  });

  it("resets the failure count after a successful login", async () => {
    for (let i = 0; i < 3; i++) await login("wrong-password-1");
    expect((await login()).status).toBe(200);
    for (let i = 0; i < 4; i++) await login("wrong-password-1");
    expect((await login()).status).toBe(200);
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION_FAILED");
  });
});

describe("sessions", () => {
  it("invalidates the session on logout", async () => {
    const cookie = sessionCookie(await login());
    await request(app).post("/api/auth/logout").set("Cookie", cookie).send({});
    expect((await me(cookie)).status).toBe(401);
  });

  it("expires after 20 idle minutes", async () => {
    const cookie = sessionCookie(await login());
    clock.advance(19);
    expect((await me(cookie)).status).toBe(200);
    clock.advance(21);
    expect((await me(cookie)).status).toBe(401);
  });

  it("expires after 12 hours even when active", async () => {
    const cookie = sessionCookie(await login());
    for (let h = 0; h < 12; h++) {
      clock.advance(60 - 1);
      await me(cookie);
    }
    clock.advance(15);
    expect((await me(cookie)).status).toBe(401);
  });

  it("ends the session when the user is deactivated", async () => {
    const cookie = sessionCookie(await login());
    await db.user.update({ where: { id: student.id }, data: { isActive: false } });
    expect((await me(cookie)).status).toBe(401);
  });
});

describe("password change", () => {
  it("enforces the policy, then signs out other sessions", async () => {
    const first = sessionCookie(await login());
    const second = sessionCookie(await login());
    const change = (body: object) => request(app).post("/api/auth/change-password").set("Cookie", second).send(body);

    expect((await change({ currentPassword: "wrong-pass-123", newPassword: "Brand-new-pass-456" })).body.error).toBe(
      "WRONG_CURRENT_PASSWORD",
    );
    for (const weak of ["short1", "abcdefghijkl", "123456789012", "student1-pass-99", student.password]) {
      const res = await change({ currentPassword: student.password, newPassword: weak });
      expect(res.body.error, weak).toBe("WEAK_PASSWORD");
    }

    const ok = await change({ currentPassword: student.password, newPassword: "Brand-new-pass-456" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
    expect((await me(second)).status).toBe(200);
    expect((await me(first)).status).toBe(401);
    expect((await login("Brand-new-pass-456")).status).toBe(200);
  });
});

describe("request hygiene", () => {
  it("rejects non-JSON writes (cross-site form posts)", async () => {
    const res = await request(app).post("/api/auth/login").type("form").send({ username: "student1", password: "x" });
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: "UNSUPPORTED_MEDIA_TYPE" });
  });

  it("answers malformed and oversized JSON with client errors, not 500", async () => {
    const bad = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    const big = await request(app)
      .post("/api/auth/login")
      .send({ username: "x", password: "y".repeat(200_000) });
    expect(big.status).toBe(413);
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "NOT_FOUND" });
  });

  it("omits upgrade-insecure-requests when cookies are not Secure (plain-http test hosts)", async () => {
    const res = await request(app).get("/api/health/live");
    expect(res.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
  });

  it("rate-limits login attempts per IP", async () => {
    const { app: fresh } = createTestApp(undefined, { LOGIN_RATE_LIMIT: "20" });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await request(fresh).post("/api/auth/login").send({ username: "ghost", password: "x" })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("audit", () => {
  it("records failed and successful logins", async () => {
    await login("nope-nope-1");
    await loginAs(app, student);
    const actions = (await db.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["auth.login_failed", "auth.login"]);
  });
});

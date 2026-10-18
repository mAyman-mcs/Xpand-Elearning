import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeUser } from "../../test/factories.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db } = createTestApp();
let w: World;
let admin: request.Agent;

beforeEach(async () => {
  await resetDb(db);
  w = await seedWorld(db);
  admin = await loginAs(app, w.users.superAdmin);
});
afterAll(() => db.$disconnect());

const usernames = (res: request.Response) =>
  (res.body as { items: { username: string }[] }).items.map((u) => u.username).sort();

describe("listing users (isolation)", () => {
  it("super admins see everyone active", async () => {
    // seedWorld: 8 actor accounts + student B.
    expect(usernames(await admin.get("/api/users"))).toHaveLength(9);
  });

  it.each([
    ["instNone", []],
    ["instExpired", []],
    ["instExamA", ["student.a"]],
    ["instSplit", ["student.a", "student.b"]],
    ["instCategory", ["student.a", "student.b"]],
  ] as const)("%s sees only reachable students", async (actor, expected) => {
    const agent = await loginAs(app, w.users[actor]);
    expect(usernames(await agent.get("/api/users"))).toEqual(expected);
    // Filters never widen the scope.
    expect(usernames(await agent.get("/api/users?role=INSTRUCTOR"))).toEqual([]);
  });

  it("filters by role, group and text, and hides inactive users unless asked", async () => {
    expect(usernames(await admin.get(`/api/users?groupId=${w.groupB.id}`))).toEqual(["student.b"]);
    expect(usernames(await admin.get("/api/users?role=STUDENT"))).toEqual(["student.a", "student.b"]);
    expect(usernames(await admin.get("/api/users?q=INST.EX"))).toEqual(["inst.exam-a", "inst.expired"]);

    await db.user.update({ where: { id: w.studentB.id }, data: { isActive: false } });
    expect(usernames(await admin.get("/api/users?role=STUDENT"))).toEqual(["student.a"]);
    expect(usernames(await admin.get("/api/users?role=STUDENT&includeInactive=true"))).toHaveLength(2);
  });

  it("paginates with a cursor", async () => {
    const first = (await admin.get("/api/users?limit=3")).body as { items: { id: string }[]; nextCursor: string };
    expect(first.items).toHaveLength(3);
    const second = (await admin.get(`/api/users?limit=3&cursor=${first.nextCursor}`)).body as {
      items: { id: string }[];
      nextCursor: string;
    };
    const third = (await admin.get(`/api/users?limit=3&cursor=${second.nextCursor}`)).body as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    const ids = [...first.items, ...second.items, ...third.items].map((u) => u.id);
    expect(new Set(ids).size).toBe(9); // 3 + 3 + 3, no duplicates
    expect(third.nextCursor).toBeNull();
  });
});

describe("creating users", () => {
  it("issues a one-time temporary password that must be changed", async () => {
    const res = await admin
      .post("/api/users")
      .send({ username: " New.Student ", fullName: "New Student", groupIds: [w.groupA.id], joinDate: "2026-07-19" });
    expect(res.status).toBe(201);
    const body = res.body as {
      user: { username: string; mustChangePassword: boolean; groups: unknown[] };
      temporaryPassword: string;
    };
    expect(body.user).toMatchObject({ username: "new.student", mustChangePassword: true, joinDate: "2026-07-19" });
    expect(body.user.groups).toEqual([{ id: w.groupA.id, name: "Group A", joinDate: null }]);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "new.student", password: body.temporaryPassword });
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it("rejects a taken username with 409 and leaves no audit entry", async () => {
    const before = await db.auditLog.count({ where: { action: "users.created" } });
    const res = await admin.post("/api/users").send({ username: "student.a", fullName: "Dup" });
    expect(res.status).toBe(409);
    expect(await db.auditLog.count({ where: { action: "users.created" } })).toBe(before);
  });

  it("rejects unknown groups", async () => {
    const res = await admin.post("/api/users").send({ username: "x.y.z", fullName: "X", groupIds: [w.e1.id] });
    expect(res.status).toBe(400);
  });
});

describe("updating users", () => {
  it("ends all sessions when the role changes or the user is deactivated", async () => {
    const studentSession = await loginAs(app, w.users.student);
    await admin.patch(`/api/users/${w.users.student.id}`).send({ fullName: "Still Logged In" });
    expect((await studentSession.get("/api/auth/me")).status).toBe(200);

    await admin.patch(`/api/users/${w.users.student.id}`).send({ isActive: false });
    expect((await studentSession.get("/api/auth/me")).status).toBe(401);

    const inst = await loginAs(app, w.users.instNone);
    await admin.patch(`/api/users/${w.users.instNone.id}`).send({ role: "STUDENT" });
    expect((await inst.get("/api/auth/me")).status).toBe(401);
  });

  it("refuses self-demotion and self-deactivation", async () => {
    expect((await admin.patch(`/api/users/${w.users.superAdmin.id}`).send({ role: "INSTRUCTOR" })).status).toBe(409);
    expect((await admin.patch(`/api/users/${w.users.superAdmin.id}`).send({ isActive: false })).status).toBe(409);
    expect((await admin.patch(`/api/users/${w.users.superAdmin.id}`).send({ fullName: "Me" })).status).toBe(200);
  });

  it("lets one super admin demote another, so the caller always remains", async () => {
    const second = await makeUser(db, { role: "SUPER_ADMIN" });
    const secondAgent = await loginAs(app, second);
    expect((await secondAgent.patch(`/api/users/${w.users.superAdmin.id}`).send({ role: "INSTRUCTOR" })).status).toBe(
      200,
    );
    // The demoted admin is signed out and can no longer manage users.
    expect((await admin.get("/api/users")).status).toBe(401);
  });

  it("audits field changes", async () => {
    await admin.patch(`/api/users/${w.studentB.id}`).send({ fullName: "Renamed", mobile: "+20 1" });
    const entry = await db.auditLog.findFirst({ where: { action: "users.updated", entityId: w.studentB.id } });
    expect(entry?.detail).toEqual({
      changes: { fullName: { from: w.studentB.fullName, to: "Renamed" }, mobile: { from: null, to: "+20 1" } },
    });
  });
});

describe("resetting passwords", () => {
  it("issues a new temporary password, unlocks the account and ends sessions", async () => {
    const session = await loginAs(app, w.studentB);
    await db.user.update({
      where: { id: w.studentB.id },
      data: { lockedUntil: new Date(Date.now() + 600_000), failedLogins: 3 },
    });

    const res = await admin.post(`/api/users/${w.studentB.id}/reset-password`).send({});
    const { temporaryPassword } = res.body as { temporaryPassword: string };
    expect((await session.get("/api/auth/me")).status).toBe(401);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: w.studentB.username, password: temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });
});

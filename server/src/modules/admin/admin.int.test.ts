import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db, clock } = createTestApp();
let w: World;
let admin: request.Agent;

beforeEach(async () => {
  await resetDb(db);
  w = await seedWorld(db, clock.now());
  admin = await loginAs(app, w.users.superAdmin);
});
afterAll(() => db.$disconnect());

describe("GET /api/admin/stats", () => {
  it("counts the seeded world", async () => {
    const res = await admin.get("/api/admin/stats");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      users: { students: 2, instructors: 5, admins: 1, inactive: 0, locked: 0 },
      groups: 2,
      exams: { draft: 0, published: 3, archived: 0 },
      assignments: 2,
      activeOverrides: 1,
      activeSessions: 1,
    });
  });

  it("counts deactivated and locked accounts, ended overrides and idle sessions correctly", async () => {
    await db.user.update({ where: { id: w.studentB.id }, data: { isActive: false } });
    await db.user.update({
      where: { id: w.users.student.id },
      data: { lockedUntil: new Date(clock.now().getTime() + 60_000) },
    });
    await db.user.update({
      where: { id: w.users.instNone.id },
      data: { lockedUntil: new Date(clock.now().getTime() - 60_000) },
    });
    await db.accessOverride.update({ where: { id: w.overrideE1A.id }, data: { validUntil: clock.now() } });
    await loginAs(app, w.users.instExamA);

    const body = (await admin.get("/api/admin/stats")).body as {
      users: Record<string, number>;
      activeOverrides: number;
      activeSessions: number;
    };
    expect(body.users).toEqual({ students: 1, instructors: 5, admins: 1, inactive: 1, locked: 1 });
    expect(body.activeOverrides).toBe(0);
    expect(body.activeSessions).toBe(2);

    // Sessions idle for longer than SESSION_IDLE_MINUTES no longer count: only a fresh login does.
    clock.advance(21); // minutes
    const fresh = await loginAs(app, w.users.superAdmin);
    expect(((await fresh.get("/api/admin/stats")).body as { activeSessions: number }).activeSessions).toBe(1);
  });
});

describe("GET /api/audit", () => {
  type Entry = {
    id: string;
    at: string;
    action: string;
    entityType: string | null;
    entityId: string | null;
    actor: { username: string } | null;
  };
  const list = async (query = "") =>
    (await admin.get(`/api/audit${query}`)).body as { items: Entry[]; nextCursor: string | null };

  beforeEach(async () => {
    await admin.post("/api/groups").send({ name: "Intake Audit", intakeStartDate: "2026-11-01" });
    clock.advance(1); // minute: distinct timestamps
    await admin.post("/api/users").send({ username: "audited.user", fullName: "Audited User" });
  });

  it("lists entries newest first with the actor", async () => {
    const { items } = await list();
    expect(items[0]).toMatchObject({ action: "users.created", entityType: "User", actor: { username: "super" } });
    expect(items[1]).toMatchObject({ action: "groups.created", entityType: "Group" });
    const ids = items.map((i) => BigInt(i.id));
    expect(ids).toEqual([...ids].sort((a, b) => (b > a ? 1 : b < a ? -1 : 0)));
  });

  it("filters by exact action, action prefix, actor, entity and time", async () => {
    expect((await list("?action=groups.created")).items.map((i) => i.action)).toEqual(["groups.created"]);
    expect((await list("?action=users.")).items.every((i) => i.action.startsWith("users."))).toBe(true);
    expect((await list(`?actorId=${w.users.instNone.id}`)).items).toEqual([]);

    const group = (await list("?action=groups.created")).items[0];
    const byEntity = await list(`?entityType=Group&entityId=${group?.entityId ?? ""}`);
    expect(byEntity.items.map((i) => i.action)).toEqual(["groups.created"]);

    const at = new Date(group?.at ?? "");
    const until = await list(`?to=${encodeURIComponent(at.toISOString())}`);
    expect(until.items.some((i) => i.action === "users.created")).toBe(false);
    const after = await list(`?from=${encodeURIComponent(new Date(at.getTime() + 1).toISOString())}`);
    expect(after.items.some((i) => i.action === "groups.created")).toBe(false);
  });

  it("paginates with a cursor", async () => {
    const first = await list("?limit=1");
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBe(first.items[0]?.id);
    const second = await list(`?limit=1&cursor=${first.nextCursor ?? ""}`);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(BigInt(second.items[0]?.id ?? "0")).toBeLessThan(BigInt(first.items[0]?.id ?? "0"));
  });

  it("rejects a malformed cursor or an inverted time range", async () => {
    expect((await admin.get("/api/audit?cursor=abc")).status).toBe(400);
    expect((await admin.get("/api/audit?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z")).status).toBe(400);
  });

  it("reading the log is not itself audited", async () => {
    const before = await db.auditLog.count();
    await list();
    await admin.get("/api/audit/actions");
    expect(await db.auditLog.count()).toBe(before);
  });

  it("lists the distinct actions, sorted", async () => {
    const actions = (await admin.get("/api/audit/actions")).body as string[];
    expect(actions).toEqual([...new Set(actions)].sort());
    expect(actions).toEqual(expect.arrayContaining(["groups.created", "users.created"]));
  });
});

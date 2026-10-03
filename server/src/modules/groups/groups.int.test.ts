import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
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

const names = (res: request.Response) => (res.body as { name: string }[]).map((g) => g.name).sort();

describe("listing groups (isolation)", () => {
  it.each([
    ["superAdmin", ["Group A", "Group B"]],
    ["instNone", []],
    ["instExpired", []],
    ["instExamA", ["Group A"]],
    ["instSplit", ["Group A", "Group B"]],
    ["instCategory", ["Group A", "Group B"]],
  ] as const)("%s sees reachable groups only", async (actor, expected) => {
    expect(names(await (await loginAs(app, w.users[actor])).get("/api/groups"))).toEqual(expected);
  });

  it("includes member counts and the intake date", async () => {
    const groupA = ((await admin.get("/api/groups")).body as { name: string }[]).find((g) => g.name === "Group A");
    expect(groupA).toMatchObject({ intakeStartDate: "2026-07-05", memberCount: 1 });
  });
});

describe("managing groups", () => {
  it("creates a group and rejects a duplicate name", async () => {
    expect((await admin.post("/api/groups").send({ name: "Intake Oct", intakeStartDate: "2026-10-04" })).status).toBe(
      201,
    );
    expect((await admin.post("/api/groups").send({ name: "Intake Oct", intakeStartDate: "2026-10-04" })).status).toBe(
      409,
    );
    expect((await admin.patch(`/api/groups/${w.groupB.id}`).send({ name: "Group A" })).status).toBe(409);
  });

  it("rejects an invalid intake date", async () => {
    const res = await admin.post("/api/groups").send({ name: "Bad", intakeStartDate: "05/07/2026" });
    expect(res.body.error).toBe("VALIDATION_FAILED");
  });

  it("adds students with a late join date, and computes each member's effective join date", async () => {
    const res = await admin
      .post(`/api/groups/${w.groupA.id}/members`)
      .send({ userIds: [w.studentB.id], joinDate: "2026-07-19" });
    const members = (
      res.body as { members: { username: string; joinDate: string | null; effectiveJoinDate: string }[] }
    ).members;
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: "student.a", joinDate: null, effectiveJoinDate: "2026-07-05" }),
        expect.objectContaining({ username: "student.b", joinDate: "2026-07-19", effectiveJoinDate: "2026-07-19" }),
      ]),
    );
  });

  it("only adds students", async () => {
    const res = await admin.post(`/api/groups/${w.groupA.id}/members`).send({ userIds: [w.users.instNone.id] });
    expect(res.status).toBe(400);
  });

  it("updates a member's join date and removes members", async () => {
    const path = `/api/groups/${w.groupA.id}/members/${w.users.student.id}`;
    const updated = await admin.patch(path).send({ joinDate: "2026-08-01" });
    expect((updated.body as { members: { effectiveJoinDate: string }[] }).members[0]?.effectiveJoinDate).toBe(
      "2026-08-01",
    );

    expect((await admin.delete(path).send({})).status).toBe(204);
    expect((await admin.delete(path).send({})).status).toBe(404);
  });

  it("audits every change", async () => {
    await admin.patch(`/api/groups/${w.groupA.id}`).send({ intakeStartDate: "2026-07-12" });
    await admin.post(`/api/groups/${w.groupA.id}/members`).send({ userIds: [w.studentB.id] });
    await admin.delete(`/api/groups/${w.groupA.id}/members/${w.studentB.id}`).send({});
    const actions = (await db.auditLog.findMany({ where: { entityId: w.groupA.id }, orderBy: { id: "asc" } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["groups.updated", "groups.members_added", "groups.member_removed"]);
  });
});

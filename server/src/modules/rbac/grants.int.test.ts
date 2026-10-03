import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db, clock } = createTestApp();
let w: World;
let admin: request.Agent;

beforeEach(async () => {
  clock.reset();
  await resetDb(db);
  w = await seedWorld(db);
  admin = await loginAs(app, w.users.superAdmin);
});
afterAll(() => db.$disconnect());

const post = (body: object) => admin.post("/api/rbac/grants").send(body);
const validationPath = (res: request.Response) => (res.body as { details?: { path: string }[] }).details?.[0]?.path;

describe("creating grants", () => {
  it("creates a grant and returns it with its scopes", async () => {
    const res = await post({
      userId: w.users.instNone.id,
      permissions: ["RESULTS_VIEW", "RESULTS_VIEW", "PROCTOR"],
      examIds: [w.e1.id],
      categoryIds: [w.cloud.id],
      groupIds: [w.groupA.id],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: w.users.instNone.id,
      permissions: ["RESULTS_VIEW", "PROCTOR"], // duplicates removed
      allExams: false,
      examIds: [w.e1.id],
      categoryIds: [w.cloud.id],
      allGroups: false,
      groupIds: [w.groupA.id],
      expiresAt: null,
      active: true,
      createdById: w.users.superAdmin.id,
    });
  });

  it.each([
    ["a student", (x: World) => ({ userId: x.users.student.id, allExams: true, allGroups: true }), "userId"],
    ["no exam scope", (x: World) => ({ userId: x.users.instNone.id, allGroups: true }), "allExams"],
    [
      "both all exams and a list",
      (x: World) => ({ userId: x.users.instNone.id, allExams: true, examIds: [x.e1.id], allGroups: true }),
      "allExams",
    ],
    ["no group scope", (x: World) => ({ userId: x.users.instNone.id, allExams: true }), "allGroups"],
    [
      "both all groups and a list",
      (x: World) => ({ userId: x.users.instNone.id, allExams: true, allGroups: true, groupIds: [x.groupA.id] }),
      "allGroups",
    ],
    [
      "an unknown exam",
      (x: World) => ({ userId: x.users.instNone.id, examIds: [x.groupA.id], allGroups: true }),
      "examIds",
    ],
    [
      "an unknown category",
      (x: World) => ({ userId: x.users.instNone.id, categoryIds: [x.e1.id], allGroups: true }),
      "categoryIds",
    ],
    [
      "an unknown group",
      (x: World) => ({ userId: x.users.instNone.id, allExams: true, groupIds: [x.e1.id] }),
      "groupIds",
    ],
    [
      "a past expiry",
      (x: World) => ({
        userId: x.users.instNone.id,
        allExams: true,
        allGroups: true,
        expiresAt: "2020-01-01T00:00:00Z",
      }),
      "expiresAt",
    ],
  ])("rejects %s", async (_label, body, path) => {
    const res = await post({ permissions: ["RESULTS_VIEW"], ...body(w) });
    expect(res.status).toBe(400);
    expect(validationPath(res)).toBe(path);
  });

  it("rejects an empty permission list", async () => {
    const res = await post({ userId: w.users.instNone.id, permissions: [], allExams: true, allGroups: true });
    expect(validationPath(res)).toBe("permissions");
  });

  it("returns 400 (not 404) for an unknown grantee", async () => {
    const res = await post({ userId: w.e1.id, permissions: ["RESULTS_VIEW"], allExams: true, allGroups: true });
    expect(validationPath(res)).toBe("userId");
  });
});

describe("updating grants", () => {
  it("keeps omitted fields (regression: partial schema defaults)", async () => {
    const res = await admin.patch(`/api/rbac/grants/${w.examAGrant.id}`).send({ permissions: ["PROCTOR"] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ permissions: ["PROCTOR"], examIds: [w.e1.id], groupIds: [w.groupA.id] });
  });

  it("replaces scope lists and validates the merged result", async () => {
    const ok = await admin
      .patch(`/api/rbac/grants/${w.examAGrant.id}`)
      .send({ examIds: [], categoryIds: [w.networking.id], groupIds: [w.groupB.id] });
    expect(ok.body).toMatchObject({ examIds: [], categoryIds: [w.networking.id], groupIds: [w.groupB.id] });

    const emptied = await admin.patch(`/api/rbac/grants/${w.examAGrant.id}`).send({ categoryIds: [] });
    expect(validationPath(emptied)).toBe("allExams");
  });

  it("returns 404 for an unknown grant", async () => {
    expect((await admin.patch(`/api/rbac/grants/${w.e1.id}`).send({ permissions: ["PROCTOR"] })).status).toBe(404);
    expect((await admin.delete(`/api/rbac/grants/${w.e1.id}`).send({})).status).toBe(404);
  });
});

describe("effect and audit", () => {
  it("takes effect on the instructor's next request, without logging out", async () => {
    const inst = await loginAs(app, w.users.instNone);
    expect((await inst.get(`/api/users/${w.users.student.id}`)).status).toBe(404);

    const grant = await post({
      userId: w.users.instNone.id,
      permissions: ["RESULTS_VIEW"],
      allExams: true,
      groupIds: [w.groupA.id],
    });
    expect((await inst.get(`/api/users/${w.users.student.id}`)).status).toBe(200);

    await admin.delete(`/api/rbac/grants/${(grant.body as { id: string }).id}`).send({});
    expect((await inst.get(`/api/users/${w.users.student.id}`)).status).toBe(404);
  });

  it("stops working at its expiry", async () => {
    // Shorter than the 20-minute session idle timeout, so only the grant expires.
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await post({
      userId: w.users.instNone.id,
      permissions: ["RESULTS_VIEW"],
      allExams: true,
      allGroups: true,
      expiresAt: expiresAt.toISOString(),
    });
    const inst = await loginAs(app, w.users.instNone);
    expect((await inst.get(`/api/users/${w.users.student.id}`)).status).toBe(200);
    clock.set(new Date(expiresAt.getTime() + 1000));
    expect((await inst.get("/api/me/permissions")).body).toEqual({ role: "INSTRUCTOR", grants: [] });
  });

  it("audits create, update and delete with snapshots", async () => {
    const created = await post({
      userId: w.users.instNone.id,
      permissions: ["RESULTS_VIEW"],
      allExams: true,
      allGroups: true,
    });
    const id = (created.body as { id: string }).id;
    await admin.patch(`/api/rbac/grants/${id}`).send({ permissions: ["PROCTOR"] });
    await admin.delete(`/api/rbac/grants/${id}`).send({});

    const entries = await db.auditLog.findMany({ where: { entityId: id }, orderBy: { id: "asc" } });
    expect(entries.map((e) => e.action)).toEqual(["rbac.grant_created", "rbac.grant_updated", "rbac.grant_deleted"]);
    expect(entries.every((e) => e.actorId === w.users.superAdmin.id)).toBe(true);
    expect(entries[1]?.detail).toMatchObject({
      before: { permissions: ["RESULTS_VIEW"] },
      after: { permissions: ["PROCTOR"] },
    });
  });

  it("writes nothing when validation fails (change and audit share one transaction)", async () => {
    const before = await db.auditLog.count();
    await post({ userId: w.users.student.id, permissions: ["RESULTS_VIEW"], allExams: true, allGroups: true });
    expect(await db.auditLog.count()).toBe(before);
    expect(await db.instructorGrant.count({ where: { userId: w.users.student.id } })).toBe(0);
  });
});

describe("/me/permissions", () => {
  it("lists an instructor's active grants only", async () => {
    const inst = await loginAs(app, w.users.instExpired);
    expect((await inst.get("/api/me/permissions")).body).toEqual({ role: "INSTRUCTOR", grants: [] });

    const split = await loginAs(app, w.users.instSplit);
    const body = (await split.get("/api/me/permissions")).body as { grants: unknown[] };
    expect(body.grants).toHaveLength(2);
  });

  it("returns the role and no grants for students and super admins", async () => {
    expect((await (await loginAs(app, w.users.student)).get("/api/me/permissions")).body).toEqual({
      role: "STUDENT",
      grants: [],
    });
  });
});

import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam, makeGrant, makeTag, makeUser } from "../../test/factories.js";
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

/** The exams group B has, and how: "tag" (through a tag given to it) or "direct". */
async function groupBExams() {
  const rows = await db.assignment.findMany({
    where: { groupId: w.groupB.id },
    select: { examId: true, tagAssignmentId: true },
  });
  return Object.fromEntries(rows.map((r) => [r.examId, r.tagAssignmentId ? "tag" : "direct"]));
}
const studentExamIds = async () =>
  ((await (await loginAs(app, w.studentB)).get("/api/student/exams")).body as { exam: { id: string } }[]).map(
    (r) => r.exam.id,
  );
const give = (tagId: string, groupId = w.groupB.id, schedule: object = { mode: "MANUAL" }) =>
  admin.post("/api/assignments/tag-bundles").send({ tagId, groupId, schedule });

describe("giving a tag to a group (a live bundle)", () => {
  it("assigns every exam carrying the tag, and the students see them", async () => {
    const soc = await makeTag(db, { name: "SOC Part 1" });
    const x1 = await makeExam(db, w.networking, { title: "SOC 1", tags: [soc] });
    const x2 = await makeExam(db, w.cloud, { title: "SOC 2", tags: [soc] });

    const res = await give(soc.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tag: { name: "SOC Part 1" },
      group: { name: "Group B" },
      examCount: 2,
      assigned: 2,
      schedule: { mode: "MANUAL" },
    });
    expect(await groupBExams()).toMatchObject({ [x1.id]: "tag", [x2.id]: "tag", [w.e3.id]: "direct" });
    expect(await studentExamIds()).toEqual(expect.arrayContaining([x1.id, x2.id]));

    // The exam page shows where the assignment comes from.
    const list = await admin.get(`/api/assignments?examId=${x1.id}`);
    expect(list.body[0]).toMatchObject({ target: { name: "Group B" }, viaTag: { name: "SOC Part 1" } });

    expect((await give(soc.id)).status).toBe(409);
    const bundles = await admin.get(`/api/assignments/tag-bundles?groupId=${w.groupB.id}`);
    expect((bundles.body as { tag: { name: string } }[]).map((b) => b.tag.name)).toEqual(["bundle", "SOC Part 1"]);
  });

  it("keeps up: exams tagged later are assigned, untagged ones are removed", async () => {
    const soc = await makeTag(db, { name: "SOC Part 1" });
    expect(
      (await give(soc.id, w.groupB.id, { mode: "RELATIVE", offsetDays: 7, openTime: "10:00", windowMinutes: 90 }))
        .status,
    ).toBe(201);

    // Created with the tag.
    const created = await admin
      .post("/api/catalog/exams")
      .send({ code: "SOC-NEW", title: "SOC new", categoryId: w.networking.id, durationMinutes: 30, tagIds: [soc.id] });
    expect(created.status).toBe(201);
    // Tagged later.
    expect((await admin.put(`/api/catalog/exams/${w.e2.id}/tags`).send({ tagIds: [soc.id] })).status).toBe(200);
    expect(await groupBExams()).toMatchObject({ [created.body.id]: "tag", [w.e2.id]: "tag" });
    const row = await db.assignment.findFirstOrThrow({ where: { examId: w.e2.id, groupId: w.groupB.id } });
    expect(row).toMatchObject({ mode: "RELATIVE", offsetDays: 7, openTime: "10:00", windowMinutes: 90 });

    // A copy carries the tag, so the group gets it too.
    const copy = await admin.post(`/api/catalog/exams/${w.e2.id}/duplicate`).send({ code: "SOC-COPY" });
    expect(copy.status).toBe(201);
    expect((await groupBExams())[copy.body.id]).toBe("tag");

    // Untagged: gone from the group.
    expect((await admin.put(`/api/catalog/exams/${w.e2.id}/tags`).send({ tagIds: [] })).status).toBe(200);
    expect((await groupBExams())[w.e2.id]).toBeUndefined();
  });

  it("never replaces a direct assignment, and takes over when it is removed", async () => {
    const soc = await makeTag(db, { name: "SOC Part 1" });
    await db.examTag.create({ data: { examId: w.e3.id, tagId: soc.id } });
    expect((await give(soc.id)).body.assigned).toBe(0); // E3 is already assigned to group B directly
    expect((await groupBExams())[w.e3.id]).toBe("direct");

    expect((await admin.delete(`/api/assignments/${w.assignmentE3B.id}`).send({})).status).toBe(204);
    expect((await groupBExams())[w.e3.id]).toBe("tag");
  });

  it("refuses removing a tag-made assignment on its own; editing its schedule detaches it", async () => {
    const soc = await makeTag(db, { name: "SOC Part 1" });
    await db.examTag.create({ data: { examId: w.e2.id, tagId: soc.id } });
    await give(soc.id);
    const row = await db.assignment.findFirstOrThrow({ where: { examId: w.e2.id, groupId: w.groupB.id } });

    const del = await admin.delete(`/api/assignments/${row.id}`).send({});
    expect(del.status).toBe(409);
    expect(del.body.message).toContain("SOC Part 1");

    const patch = await admin
      .patch(`/api/assignments/${row.id}`)
      .send({ schedule: { mode: "FIXED", opensAt: "2026-12-01T08:00:00Z", closesAt: null } });
    expect(patch.status).toBe(200);
    expect(patch.body.viaTag).toBeNull();
    // Detached: taking the tag off the exam no longer removes it.
    await admin.put(`/api/catalog/exams/${w.e2.id}/tags`).send({ tagIds: [] });
    expect((await groupBExams())[w.e2.id]).toBe("direct");
  });

  it("removing the bundle removes its exams, unless another tag given to the group covers them", async () => {
    const soc = await makeTag(db, { name: "SOC Part 1" });
    const all = await makeTag(db, { name: "Everything" });
    const x = await makeExam(db, w.networking, { title: "SOC 1", tags: [soc, all] });
    const only = await makeExam(db, w.networking, { title: "SOC 2", tags: [soc] });
    const first = (await give(soc.id)).body.id as string;
    await give(all.id);

    expect((await admin.delete(`/api/assignments/tag-bundles/${first}`).send({})).status).toBe(204);
    const now = await groupBExams();
    expect(now[x.id]).toBe("tag"); // still covered by "Everything"
    expect(now[only.id]).toBeUndefined();
    const audit = await db.auditLog.findFirst({ where: { action: "assignments.tag_bundle_deleted" } });
    expect(audit?.detail).toMatchObject({ tagId: soc.id, groupId: w.groupB.id });
  });

  it("a tag given to a group can't be deleted", async () => {
    const res = await admin.delete(`/api/catalog/tags/${w.tagBundle.id}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("given to 1 group");
  });
});

describe("who may give tags and tag exams", () => {
  it("needs EXAM_ASSIGN on the tag (all its exams) and the group", async () => {
    const soc = await makeTag(db, { name: "SOC Part 1" });
    const inst = await makeUser(db, { role: "INSTRUCTOR", username: "inst.soc" });
    await makeGrant(db, inst, { permissions: ["EXAM_ASSIGN"], tagIds: [soc.id], groupIds: [w.groupB.id] });
    const agent = await loginAs(app, inst);
    const post = (groupId: string) =>
      agent.post("/api/assignments/tag-bundles").send({ tagId: soc.id, groupId, schedule: { mode: "MANUAL" } });

    expect((await post(w.groupA.id)).status).toBe(404); // group A is outside the grant
    expect((await post(w.groupB.id)).status).toBe(201);
    // Lists only what they can manage: not "bundle" → group B.
    const list = await agent.get("/api/assignments/tag-bundles");
    expect((list.body as { tag: { name: string } }[]).map((b) => b.tag.name)).toEqual(["SOC Part 1"]);
  });

  it("putting a given tag on an exam assigns it, so it needs EXAM_ASSIGN for those groups", async () => {
    // instCategory: EXAM_EDIT + EXAM_ASSIGN on Cloud × all groups. Can tag E3 with "bundle" (given to B).
    const ok = await loginAs(app, w.users.instCategory);
    expect((await ok.put(`/api/catalog/exams/${w.e3.id}/tags`).send({ tagIds: [w.tagBundle.id] })).status).toBe(200);

    // An editor without EXAM_ASSIGN can still tag, but not with a tag given to a group.
    const editor = await makeUser(db, { role: "INSTRUCTOR", username: "inst.editor" });
    await makeGrant(db, editor, { permissions: ["EXAM_EDIT"], categoryIds: [w.networking.id], allGroups: true });
    const agent = await loginAs(app, editor);
    expect((await agent.put(`/api/catalog/exams/${w.e2.id}/tags`).send({ tagIds: [w.tagSpare.id] })).status).toBe(200);
    const refused = await agent.put(`/api/catalog/exams/${w.e2.id}/tags`).send({ tagIds: [w.tagBundle.id] });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("Group B");
    expect((await groupBExams())[w.e2.id]).toBeUndefined();
  });
});

describe("showing results to students", () => {
  async function gradedAttempt() {
    return db.attempt.create({
      data: {
        examId: w.e3.id,
        userId: w.studentB.id,
        status: "SUBMITTED",
        submittedAt: clock.now(),
        score: 8,
        maxScore: 10,
      },
    });
  }
  const e3Row = async () => {
    const rows = (await (await loginAs(app, w.studentB)).get("/api/student/exams")).body as {
      exam: { id: string };
      resultsReleased: boolean;
      result: unknown;
    }[];
    return rows.find((r) => r.exam.id === w.e3.id);
  };

  it("hides scores until staff release them, and hides them again on request", async () => {
    const attempt = await gradedAttempt();
    const student = await loginAs(app, w.studentB);
    expect(await e3Row()).toMatchObject({ resultsReleased: false, result: null });
    expect((await student.get(`/api/attempts/${attempt.id}/outcome`)).body).toMatchObject({
      resultsReleased: false,
      result: null,
    });
    expect((await admin.get(`/api/catalog/exams/${w.e3.id}/results`)).body).toEqual({
      released: false,
      releasedAt: null,
      submitted: 1,
      graded: 1,
    });

    const released = await admin.put(`/api/catalog/exams/${w.e3.id}/results-release`).send({ released: true });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ released: true, releasedAt: expect.any(String) });
    expect(await e3Row()).toMatchObject({ resultsReleased: true, result: { score: 8, maxScore: 10 } });
    expect((await student.get(`/api/attempts/${attempt.id}/outcome`)).body.result).toEqual({ score: 8, maxScore: 10 });
    expect((await admin.get(`/api/catalog/exams/${w.e3.id}`)).body).toMatchObject({ resultsReleased: true });

    const hidden = await admin.put(`/api/catalog/exams/${w.e3.id}/results-release`).send({ released: false });
    expect(hidden.body).toMatchObject({ released: false, releasedAt: null });
    expect(await e3Row()).toMatchObject({ resultsReleased: false, result: null });

    const actions = await db.auditLog.findMany({ where: { entityId: w.e3.id }, orderBy: { at: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["results.released", "results.hidden"]);
  });

  it("released, but not graded yet: no score until a grader approves", async () => {
    await db.attempt.create({
      data: { examId: w.e3.id, userId: w.studentB.id, status: "SUBMITTED", submittedAt: clock.now() },
    });
    await admin.put(`/api/catalog/exams/${w.e3.id}/results-release`).send({ released: true });
    expect(await e3Row()).toMatchObject({ resultsReleased: true, result: null });
    expect((await admin.get(`/api/catalog/exams/${w.e3.id}/results`)).body).toMatchObject({ submitted: 1, graded: 0 });
  });

  it("releasing twice is harmless and logged once", async () => {
    await admin.put(`/api/catalog/exams/${w.e3.id}/results-release`).send({ released: true });
    await admin.put(`/api/catalog/exams/${w.e3.id}/results-release`).send({ released: true });
    expect(await db.auditLog.count({ where: { action: "results.released" } })).toBe(1);
  });
});

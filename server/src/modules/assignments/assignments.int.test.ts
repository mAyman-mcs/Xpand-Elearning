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

interface StudentExam {
  exam: { id: string; title: string };
  status: string;
  progress: string;
  opensAt: string | null;
  closesAt: string | null;
}
const studentView = async (user: { username: string; password: string }) =>
  (await (await loginAs(app, user)).get("/api/student/exams")).body as StudentExam[];
const statusOf = (rows: StudentExam[], examId: string) => rows.find((r) => r.exam.id === examId)?.status;

const relative = { mode: "RELATIVE", offsetDays: 14, openTime: "10:00", windowMinutes: 120 };

describe("assigning one exam", () => {
  it("makes the exam visible to the target only, and refuses duplicates", async () => {
    expect(statusOf(await studentView(w.studentB), w.e2.id)).toBeUndefined();

    const res = await admin
      .post("/api/assignments")
      .send({ examId: w.e2.id, target: { groupId: w.groupB.id }, schedule: { mode: "MANUAL" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      target: { type: "group", name: "Group B" },
      schedule: { mode: "MANUAL", opensAt: null },
    });

    expect(statusOf(await studentView(w.studentB), w.e2.id)).toBe("CLOSED"); // manual: closed until opened
    expect(statusOf(await studentView(w.users.student), w.e2.id)).toBeUndefined();

    const again = await admin
      .post("/api/assignments")
      .send({ examId: w.e2.id, target: { groupId: w.groupB.id }, schedule: { mode: "MANUAL" } });
    expect(again.status).toBe(409);
  });

  it("validates schedules", async () => {
    const post = (schedule: object) =>
      admin.post("/api/assignments").send({ examId: w.e2.id, target: { groupId: w.groupB.id }, schedule });
    expect(
      (await post({ mode: "FIXED", opensAt: "2026-11-01T10:00:00Z", closesAt: "2026-11-01T09:00:00Z" })).status,
    ).toBe(400);
    expect((await post({ mode: "RELATIVE", offsetDays: 3, openTime: "25:00", windowMinutes: 60 })).status).toBe(400);
    expect((await post({ mode: "RELATIVE", offsetDays: 3, openTime: "10:00" })).status).toBe(400);
    expect((await post({ mode: "SOMETIMES" })).status).toBe(400);
  });

  it("refuses targets with both or neither of user and group", async () => {
    const post = (target: object) =>
      admin.post("/api/assignments").send({ examId: w.e2.id, target, schedule: { mode: "MANUAL" } });
    expect((await post({})).status).toBe(400);
    expect((await post({ userId: w.studentB.id, groupId: w.groupB.id })).status).toBe(400);
  });

  it("hides draft exams from students; shows archived ones as closed", async () => {
    const draft = await makeExam(db, w.networking, { title: "Draft", status: "DRAFT" });
    await admin
      .post("/api/assignments")
      .send({ examId: draft.id, target: { groupId: w.groupA.id }, schedule: { mode: "MANUAL" } });
    expect(statusOf(await studentView(w.users.student), draft.id)).toBeUndefined();

    await db.exam.update({ where: { id: w.e1.id }, data: { status: "ARCHIVED" } });
    expect(statusOf(await studentView(w.users.student), w.e1.id)).toBe("CLOSED");
    // Archived exams can no longer be assigned.
    const res = await admin
      .post("/api/assignments")
      .send({ examId: w.e1.id, target: { userId: w.studentB.id }, schedule: { mode: "MANUAL" } });
    expect(res.status).toBe(400);
  });

  it("reschedules and deletes, auditing each change", async () => {
    const id = w.assignmentE3B.id;
    const patched = await admin.patch(`/api/assignments/${id}`).send({ schedule: relative });
    expect(patched.body.schedule).toMatchObject(relative);
    expect((await admin.delete(`/api/assignments/${id}`).send({})).status).toBe(204);
    const actions = (await db.auditLog.findMany({ where: { entityId: id }, orderBy: { id: "asc" } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["assignments.rescheduled", "assignments.deleted"]);
  });
});

describe("relative schedules through the API", () => {
  it("anchor on the intake date, or a late joiner's own join date", async () => {
    const late = await makeUser(db, { groups: [{ group: w.groupB, joinDate: new Date("2026-07-19T00:00:00Z") }] });
    await admin
      .post("/api/assignments")
      .send({ examId: w.e2.id, target: { groupId: w.groupB.id }, schedule: relative });

    clock.set("2026-07-10T00:00:00Z");
    // Group intake 2026-07-05 + 14 days, 10:00 Cairo (UTC+3) = 07:00Z.
    const onTime = (await studentView(w.studentB)).find((r) => r.exam.id === w.e2.id);
    expect(onTime).toMatchObject({
      status: "SCHEDULED",
      opensAt: "2026-07-19T07:00:00.000Z",
      closesAt: "2026-07-19T09:00:00.000Z",
    });
    const lateView = (await studentView(late)).find((r) => r.exam.id === w.e2.id);
    expect(lateView).toMatchObject({ status: "SCHEDULED", opensAt: "2026-08-02T07:00:00.000Z" });

    clock.set("2026-07-19T07:30:00Z");
    expect(statusOf(await studentView(w.studentB), w.e2.id)).toBe("OPEN");
    clock.set("2026-07-19T09:00:00Z");
    expect(statusOf(await studentView(w.studentB), w.e2.id)).toBe("MISSED");
  });
});

describe("personal assignments replace group ones (D7)", () => {
  it("a scheduled personal assignment overrides an open group window", async () => {
    expect(statusOf(await studentView(w.users.student), w.e1.id)).toBe("OPEN"); // seed: group A window + override
    await admin.post(`/api/overrides/${w.overrideE1A.id}/end`).send({});
    expect(statusOf(await studentView(w.users.student), w.e1.id)).toBe("OPEN"); // the group window is open

    await admin.post("/api/assignments").send({
      examId: w.e1.id,
      target: { userId: w.users.student.id },
      schedule: { mode: "FIXED", opensAt: "2099-01-01T07:00:00Z", closesAt: null },
    });
    const view = (await studentView(w.users.student)).find((r) => r.exam.id === w.e1.id);
    expect(view).toMatchObject({ status: "SCHEDULED", opensAt: "2099-01-01T07:00:00.000Z" });
  });
});

describe("overrides through the API", () => {
  it("open now, then end; ending keeps the record and restores the schedule", async () => {
    // E3 → group B is MANUAL: closed until opened.
    expect(statusOf(await studentView(w.studentB), w.e3.id)).toBe("CLOSED");
    const opened = await admin
      .post("/api/overrides")
      .send({ examId: w.e3.id, target: { groupId: w.groupB.id }, action: "OPEN", reason: "Make-up session" });
    expect(opened.status).toBe(201);
    expect(statusOf(await studentView(w.studentB), w.e3.id)).toBe("OPEN");

    const id = (opened.body as { id: string }).id;
    const ended = await admin.post(`/api/overrides/${id}/end`).send({});
    expect(ended.body.active).toBe(false);
    expect(statusOf(await studentView(w.studentB), w.e3.id)).toBe("CLOSED");
    expect((await admin.post(`/api/overrides/${id}/end`).send({})).status).toBe(409);

    const active = (await admin.get(`/api/overrides?examId=${w.e3.id}`)).body as unknown[];
    const all = (await admin.get(`/api/overrides?examId=${w.e3.id}&includeEnded=true`)).body as unknown[];
    expect([active.length, all.length]).toEqual([0, 1]);
  });

  it("requires a reason", async () => {
    const res = await admin
      .post("/api/overrides")
      .send({ examId: w.e3.id, target: { groupId: w.groupB.id }, action: "OPEN" });
    expect(res.status).toBe(400);
  });

  it("a personal CLOSE beats a group OPEN", async () => {
    await admin
      .post("/api/overrides")
      .send({ examId: w.e1.id, target: { userId: w.users.student.id }, action: "CLOSE", reason: "Misconduct review" });
    expect(statusOf(await studentView(w.users.student), w.e1.id)).toBe("CLOSED");
  });
});

describe("bulk assignment (D8)", () => {
  it("assigns every exam of a category to several targets in one go, as plain rows", async () => {
    const extra = await makeExam(db, w.cloud, { title: "Cloud 2" });
    const res = await admin.post("/api/assignments/bulk").send({
      categoryId: w.cloud.id,
      targets: [{ groupId: w.groupA.id }, { userId: w.studentB.id }],
      schedule: { mode: "MANUAL" },
    });
    expect(res.body).toEqual({ created: 4 }); // (E3, Cloud 2) × (group A, student B)
    expect(await db.assignment.count({ where: { examId: extra.id } })).toBe(2);

    // Not a live rule: a Cloud exam created afterwards is not assigned to anyone.
    const later = await makeExam(db, w.cloud, { title: "Cloud 3" });
    expect(await db.assignment.count({ where: { examId: later.id } })).toBe(0);
  });

  it("selects by tags (all of them) and skips archived exams", async () => {
    const midterm = await makeTag(db, { name: "midterm" });
    await makeExam(db, w.networking, { title: "Both", tags: [w.tagCore, midterm] });
    await makeExam(db, w.networking, { title: "Archived", tags: [w.tagCore, midterm], status: "ARCHIVED" });
    const res = await admin
      .post("/api/assignments/bulk")
      .send({ tagIds: [w.tagCore.id, midterm.id], targets: [{ groupId: w.groupB.id }], schedule: { mode: "MANUAL" } });
    expect(res.body).toEqual({ created: 1 });
  });

  it("is all or nothing when any pair is outside the caller's scope", async () => {
    // instExamA: EXAM_ASSIGN on E1 × group A only.
    const inst = await loginAs(app, w.users.instExamA);
    const before = await db.assignment.count();
    const res = await inst.post("/api/assignments/bulk").send({
      examIds: [w.e1.id],
      targets: [{ userId: w.users.student.id }, { userId: w.studentB.id }],
      schedule: { mode: "MANUAL" },
    });
    expect(res.status).toBe(403);
    expect(res.body.details).toEqual([{ examId: w.e1.id, target: { userId: w.studentB.id } }]);
    expect(await db.assignment.count()).toBe(before);

    const ok = await inst
      .post("/api/assignments/bulk")
      .send({ examIds: [w.e1.id], targets: [{ userId: w.users.student.id }], schedule: { mode: "MANUAL" } });
    expect(ok.status).toBe(201);
  });

  it("is all or nothing on duplicates, and writes one audit entry when it succeeds", async () => {
    const res = await admin.post("/api/assignments/bulk").send({
      examIds: [w.e1.id, w.e2.id],
      targets: [{ groupId: w.groupA.id }],
      schedule: { mode: "MANUAL" },
    });
    expect(res.status).toBe(409); // E1 → group A exists in the seed world
    expect(await db.assignment.count({ where: { examId: w.e2.id } })).toBe(0);

    await admin
      .post("/api/assignments/bulk")
      .send({ examIds: [w.e2.id], targets: [{ groupId: w.groupA.id }, { groupId: w.groupB.id }], schedule: relative });
    const entries = await db.auditLog.findMany({ where: { action: "assignments.bulk_created" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toMatchObject({ count: 2, examIds: [w.e2.id] });
  });

  it("an instructor selecting a category only gets exams they can see", async () => {
    // instExamA sees E1 only; Networking also holds E2. Selecting Networking yields E1 alone.
    const inst = await loginAs(app, w.users.instExamA);
    const res = await inst
      .post("/api/assignments/bulk")
      .send({ categoryId: w.networking.id, targets: [{ userId: w.users.student.id }], schedule: { mode: "MANUAL" } });
    expect(res.body).toEqual({ created: 1 });
  });
});

describe("preview", () => {
  it("matches what each student sees after saving", async () => {
    const late = await makeUser(db, { groups: [{ group: w.groupB, joinDate: new Date("2026-07-19T00:00:00Z") }] });
    const body = { examIds: [w.e2.id], targets: [{ groupId: w.groupB.id }], schedule: relative };

    const preview = (await admin.post("/api/assignments/preview").send(body)).body as {
      student: { id: string };
      opensAt: string;
      closesAt: string;
    }[];
    expect(preview).toHaveLength(2);
    expect(await db.assignment.count({ where: { examId: w.e2.id } })).toBe(0); // nothing saved

    await admin.post("/api/assignments/bulk").send(body);
    clock.set("2026-07-01T00:00:00Z");
    for (const user of [w.studentB, late]) {
      const row = (await studentView(user)).find((r) => r.exam.id === w.e2.id);
      const predicted = preview.find((p) => p.student.id === user.id);
      expect(row).toMatchObject({ opensAt: predicted?.opensAt, closesAt: predicted?.closesAt });
    }
  });

  it("flags students whose personal assignment would replace the group schedule", async () => {
    await admin
      .post("/api/assignments")
      .send({ examId: w.e2.id, target: { userId: w.studentB.id }, schedule: { mode: "MANUAL" } });
    const preview = (
      await admin
        .post("/api/assignments/preview")
        .send({ examIds: [w.e2.id], targets: [{ groupId: w.groupB.id }], schedule: relative })
    ).body as {
      replacedByPersonalAssignment: boolean;
    }[];
    expect(preview.map((p) => p.replacedByPersonalAssignment)).toEqual([true]);
  });
});

describe("staff availability view", () => {
  it("lists reachable assigned students with status, source and reason", async () => {
    const inst = await loginAs(app, w.users.instExamA); // E1 × group A
    await admin
      .post("/api/assignments")
      .send({ examId: w.e1.id, target: { userId: w.studentB.id }, schedule: { mode: "MANUAL" } });

    const rows = (await inst.get(`/api/assignments/availability?examId=${w.e1.id}`)).body as {
      student: { username: string };
      status: string;
      source: string;
    }[];
    // student B (group B) is assigned too, but outside instExamA's groups.
    expect(rows.map((r) => r.student.username)).toEqual(["student.a"]);
    expect(rows[0]).toMatchObject({ status: "OPEN", source: "group-override" });

    const all = (await admin.get(`/api/assignments/availability?examId=${w.e1.id}`)).body as unknown[];
    expect(all).toHaveLength(2);
  });

  it("instructors only list assignments for targets in their scope", async () => {
    await makeGrant(db, w.users.instNone, {
      permissions: ["EXAM_ASSIGN"],
      examIds: [w.e1.id],
      groupIds: [w.groupB.id],
    });
    await admin
      .post("/api/assignments")
      .send({ examId: w.e1.id, target: { groupId: w.groupB.id }, schedule: { mode: "MANUAL" } });
    const inst = await loginAs(app, w.users.instNone);
    const rows = (await inst.get(`/api/assignments?examId=${w.e1.id}`)).body as { target: { name: string } }[];
    expect(rows.map((r) => r.target.name)).toEqual(["Group B"]);
  });
});

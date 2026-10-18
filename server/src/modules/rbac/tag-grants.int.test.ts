import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeUser, type TestUser } from "../../test/factories.js";
import { loginAs } from "../../test/http.js";

// Tag grants with "students who submitted" (the SOC scenario), end to end through the API:
// an exam created with its required fields, a student in a batch, an instructor granted the "soc"
// tag, and the tag put on the exam. The instructor must reach the soc exam, and only the students
// who have SUBMITTED a soc exam — nothing else.

const { app, db } = createTestApp();
let admin: request.Agent;
let instructor: request.Agent;
let ids: { soc: string; socExam: string; otherExam: string; batch: string; student: TestUser; other: TestUser };

const post = async <T>(agent: request.Agent, url: string, body: object, status = 201): Promise<T> => {
  const res = await agent.post(url).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as T;
};
const submit = (examId: string, userId: string, status: "SUBMITTED" | "IN_PROGRESS" | "VOIDED" = "SUBMITTED") =>
  // Students submit through the exam session (phase B6); until then the test writes the attempt.
  db.attempt.create({ data: { examId, userId, status } });

beforeEach(async () => {
  await resetDb(db);
  const superAdmin = await makeUser(db, { role: "SUPER_ADMIN", username: "root" });
  admin = await loginAs(app, superAdmin);

  // 1. An exam with only the required fields (code, title, category, duration), and another one.
  const category = await post<{ id: string }>(admin, "/api/catalog/categories", { name: "Security" });
  const socExam = await post<{ id: string; status: string; tags: unknown[] }>(admin, "/api/catalog/exams", {
    code: "SOC-1",
    title: "SOC Analyst",
    categoryId: category.id,
    durationMinutes: 60,
  });
  expect(socExam).toMatchObject({ status: "DRAFT", tags: [] });
  const otherExam = await post<{ id: string }>(admin, "/api/catalog/exams", {
    code: "NET-1",
    title: "Networking",
    categoryId: category.id,
    durationMinutes: 45,
  });

  // 2. Students in a batch (group).
  const batch = await post<{ id: string }>(admin, "/api/groups", { name: "Batch 7", intakeStartDate: "2026-10-01" });
  const student = await makeUser(db, { username: "soc.student" });
  const other = await makeUser(db, { username: "other.student" });
  await post(admin, `/api/groups/${batch.id}/members`, { userIds: [student.id, other.id] }, 200);

  // 3. An instructor whose only grant is the "soc" tag, for students who submitted.
  const soc = await post<{ id: string }>(admin, "/api/catalog/tags", { name: "soc" });
  const inst = await makeUser(db, { role: "INSTRUCTOR", username: "soc.instructor" });
  await post(admin, "/api/rbac/grants", {
    userId: inst.id,
    permissions: ["RESULTS_VIEW", "EXAM_ASSIGN", "EXAM_SCHEDULE", "EXAM_EDIT"],
    tagIds: [soc.id],
    studentsWhoSubmitted: true,
  });
  instructor = await loginAs(app, inst);

  // 4. The soc tag goes on the exam (by the super admin).
  await admin
    .put(`/api/catalog/exams/${socExam.id}/tags`)
    .send({ tagIds: [soc.id] })
    .expect(200);

  ids = { soc: soc.id, socExam: socExam.id, otherExam: otherExam.id, batch: batch.id, student, other };
});
afterAll(() => db.$disconnect());

const examCodes = async () =>
  ((await instructor.get("/api/catalog/exams")).body as { items: { code: string }[] }).items.map((e) => e.code);
const studentNames = async () =>
  ((await instructor.get("/api/users")).body as { items: { username: string }[] }).items.map((u) => u.username);

describe("an instructor with the soc tag, for students who submitted", () => {
  it("reaches only the soc exam", async () => {
    expect(await examCodes()).toEqual(["SOC-1"]);
    expect((await instructor.get(`/api/catalog/exams/${ids.socExam}`)).status).toBe(200);
    expect((await instructor.get(`/api/catalog/exams/${ids.otherExam}`)).status).toBe(404);
  });

  it("sees no student until one submits the soc exam, then exactly that student", async () => {
    expect(await studentNames()).toEqual([]);
    expect((await instructor.get(`/api/users/${ids.student.id}`)).status).toBe(404);

    await submit(ids.socExam, ids.student.id);
    expect(await studentNames()).toEqual(["soc.student"]);
    expect((await instructor.get(`/api/users/${ids.student.id}`)).status).toBe(200);
    // Same batch, not submitted: still invisible.
    expect((await instructor.get(`/api/users/${ids.other.id}`)).status).toBe(404);
    expect((await instructor.get(`/api/users/lookup?q=student`)).body).toEqual([
      expect.objectContaining({ username: "soc.student" }),
    ]);
  });

  it("doesn't count other exams, attempts in progress, or voided attempts", async () => {
    await submit(ids.otherExam, ids.other.id); // submitted, but not a soc exam
    await submit(ids.socExam, ids.other.id, "IN_PROGRESS");
    const voided = await makeUser(db, { username: "voided.student" });
    await submit(ids.socExam, voided.id, "VOIDED");
    expect(await studentNames()).toEqual([]);
  });

  it("never reaches the batch as a group, only students through their submissions", async () => {
    await submit(ids.socExam, ids.student.id);
    expect((await instructor.get("/api/groups")).body).toEqual([]);
    expect((await instructor.get(`/api/groups/${ids.batch}`)).status).toBe(404);
    // Assigning or opening for the whole batch is refused; for the submitted student it is allowed.
    const toBatch = await instructor
      .post("/api/assignments")
      .send({ examId: ids.socExam, target: { groupId: ids.batch }, schedule: { mode: "MANUAL" } });
    expect(toBatch.status).toBe(404);
    const toStudent = await instructor
      .post("/api/assignments")
      .send({ examId: ids.socExam, target: { userId: ids.student.id }, schedule: { mode: "MANUAL" } });
    expect(toStudent.status).toBe(201);
  });

  it("sees only submitted students on the soc exam's availability", async () => {
    await admin
      .post("/api/assignments")
      .send({ examId: ids.socExam, target: { groupId: ids.batch }, schedule: { mode: "MANUAL" } })
      .expect(201);
    await submit(ids.socExam, ids.student.id);
    const rows = (await instructor.get(`/api/assignments/availability?examId=${ids.socExam}`)).body as {
      student: { username: string };
    }[];
    expect(rows.map((r) => r.student.username)).toEqual(["soc.student"]);
    // The admin sees the whole batch.
    const all = (await admin.get(`/api/assignments/availability?examId=${ids.socExam}`)).body as unknown[];
    expect(all).toHaveLength(2);
  });

  it("loses the exam and its students the moment the tag is taken off the exam", async () => {
    await submit(ids.socExam, ids.student.id);
    expect(await studentNames()).toEqual(["soc.student"]);
    await admin.put(`/api/catalog/exams/${ids.socExam}/tags`).send({ tagIds: [] }).expect(200);
    expect(await examCodes()).toEqual([]);
    expect(await studentNames()).toEqual([]);
  });

  it("gains a newly tagged exam automatically (any of the grant's tags)", async () => {
    await admin
      .put(`/api/catalog/exams/${ids.otherExam}/tags`)
      .send({ tagIds: [ids.soc] })
      .expect(200);
    expect((await examCodes()).sort()).toEqual(["NET-1", "SOC-1"]);
  });
});

describe("access tags are changed by super admins only", () => {
  let editor: request.Agent;
  beforeEach(async () => {
    // An instructor who may edit every exam in the category: the most an instructor can hold.
    const user = await makeUser(db, { role: "INSTRUCTOR", username: "category.editor" });
    const category = ((await admin.get("/api/catalog/categories")).body as { id: string }[])[0]?.id ?? "";
    await post(admin, "/api/rbac/grants", {
      userId: user.id,
      permissions: ["EXAM_EDIT"],
      categoryIds: [category],
      allGroups: true,
    });
    editor = await loginAs(app, user);
  });

  it("an instructor can't put the soc tag on an exam, take it off, create or duplicate with it", async () => {
    const add = await editor.put(`/api/catalog/exams/${ids.otherExam}/tags`).send({ tagIds: [ids.soc] });
    expect(add.status).toBe(403);
    expect((add.body as { message: string }).message).toContain("Only a super admin can add or remove “soc”");
    expect((await editor.put(`/api/catalog/exams/${ids.socExam}/tags`).send({ tagIds: [] })).status).toBe(403);

    const category = ((await admin.get("/api/catalog/categories")).body as { id: string }[])[0]?.id ?? "";
    const create = await editor
      .post("/api/catalog/exams")
      .send({ code: "SOC-2", title: "SOC 2", categoryId: category, durationMinutes: 30, tagIds: [ids.soc] });
    expect(create.status).toBe(403);
    expect((await editor.post(`/api/catalog/exams/${ids.socExam}/duplicate`).send({ code: "SOC-COPY" })).status).toBe(
      403,
    );
  });

  it("plain tags stay free for instructors", async () => {
    const plain = await post<{ id: string }>(admin, "/api/catalog/tags", { name: "midterm" });
    expect((await editor.put(`/api/catalog/exams/${ids.otherExam}/tags`).send({ tagIds: [plain.id] })).status).toBe(
      200,
    );
  });

  it("the tag list marks access tags, and an access tag can't be deleted while a grant uses it", async () => {
    const tags = (await admin.get("/api/catalog/tags")).body as { name: string; grantCount: number }[];
    expect(tags.find((t) => t.name === "soc")?.grantCount).toBe(1);
    const res = await admin.delete(`/api/catalog/tags/${ids.soc}`).send({});
    expect(res.status).toBe(409);
    expect((res.body as { message: string }).message).toContain("remove it from those grants first");
  });
});

describe("grant validation", () => {
  const grant = async (body: object) => {
    const inst = await makeUser(db, { role: "INSTRUCTOR" });
    return admin.post("/api/rbac/grants").send({ userId: inst.id, permissions: ["RESULTS_VIEW"], ...body });
  };

  it("needs exactly one student scope", async () => {
    for (const body of [
      { tagIds: [ids.soc] }, // none
      { tagIds: [ids.soc], allGroups: true, studentsWhoSubmitted: true },
      { tagIds: [ids.soc], groupIds: [ids.batch], studentsWhoSubmitted: true },
    ]) {
      const res = await grant(body);
      expect(res.status).toBe(400);
      expect((res.body as { details: { path: string }[] }).details[0]?.path).toBe("allGroups");
    }
  });

  it("refuses unknown tags; a tag counts as an exam scope", async () => {
    expect((await grant({ tagIds: ["00000000-0000-4000-8000-000000000000"], allGroups: true })).status).toBe(400);
    expect((await grant({ tagIds: [ids.soc], allExams: true, allGroups: true })).status).toBe(400);
    expect((await grant({ tagIds: [ids.soc], groupIds: [ids.batch] })).status).toBe(201);
  });

  it("the database refuses a grant that is both all groups and students-who-submitted", async () => {
    const inst = await makeUser(db, { role: "INSTRUCTOR" });
    await expect(
      db.instructorGrant.create({
        data: {
          userId: inst.id,
          permissions: ["RESULTS_VIEW"],
          allExams: true,
          allGroups: true,
          studentsWhoSubmitted: true,
        },
      }),
    ).rejects.toThrow(/InstructorGrant_student_scope/);
  });
});

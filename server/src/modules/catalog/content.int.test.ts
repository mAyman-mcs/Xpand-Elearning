import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam, makeGrant, makeUser } from "../../test/factories.js";
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

type Question = {
  id: string;
  type: string;
  text: string;
  points: number;
  position: number;
  options: { id: string; text: string; isCorrect: boolean }[];
};
type List = { locked: boolean; questions: Question[]; publishProblems: string[] };

const single = (text: string) => ({
  type: "SINGLE_CHOICE",
  text,
  options: [
    { text: "Right", isCorrect: true },
    { text: "Wrong", isCorrect: false },
  ],
});
const list = async (examId: string) => (await admin.get(`/api/catalog/exams/${examId}/questions`)).body as List;
const lock = (examId: string) =>
  db.attempt.create({ data: { examId, userId: w.users.student.id, status: "SUBMITTED" } });

// E1 is locked in the world (student B has submitted it); question editing uses E2.
describe("questions", () => {
  it("creates questions at the end, with the answer key for staff", async () => {
    const res = await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single("First?"));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ text: "First?", points: 1, position: 0, imageUrl: null });
    await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single("Second?"));
    const { questions, locked } = await list(w.e2.id);
    expect(locked).toBe(false);
    expect(questions.map((q) => [q.text, q.position])).toEqual([
      ["First?", 0],
      ["Second?", 1],
    ]);
    expect(questions[0]?.options).toEqual([
      expect.objectContaining({ text: "Right", isCorrect: true }),
      expect.objectContaining({ text: "Wrong", isCorrect: false }),
    ]);
  });

  it("refuses invalid questions with a readable message", async () => {
    const res = await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send({
      ...single("Two right?"),
      options: [
        { text: "a", isCorrect: true },
        { text: "b", isCorrect: true },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "VALIDATION_FAILED", message: "Mark exactly one option as correct." });
    expect(
      (
        await admin
          .post(`/api/catalog/exams/${w.e2.id}/questions`)
          .send({ ...single("x"), imageUrl: "http://insecure.example/a.png" })
      ).status,
    ).toBe(400);
  });

  it("edits a question; options are replaced as a whole", async () => {
    const q = (await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single("Old?"))).body as Question;
    const res = await admin.patch(`/api/catalog/questions/${q.id}`).send({
      type: "MULTI_CHOICE",
      text: "New?",
      points: 2,
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: true },
        { text: "C", isCorrect: false },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: "MULTI_CHOICE", text: "New?", points: 2 });
    expect((res.body as Question).options.map((o) => o.text)).toEqual(["A", "B", "C"]);
    // The merged result is validated: a single-choice question can't keep two correct answers.
    expect((await admin.patch(`/api/catalog/questions/${q.id}`).send({ type: "SINGLE_CHOICE" })).status).toBe(400);
  });

  it("deletes and renumbers; reorders with the complete list only", async () => {
    const ids: string[] = [];
    for (const t of ["A", "B", "C"])
      ids.push(((await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single(t))).body as Question).id);
    expect((await admin.delete(`/api/catalog/questions/${ids[1] ?? ""}`).send({})).status).toBe(204);
    expect((await list(w.e2.id)).questions.map((q) => [q.text, q.position])).toEqual([
      ["A", 0],
      ["C", 1],
    ]);

    const order = `/api/catalog/exams/${w.e2.id}/questions/order`;
    expect((await admin.put(order).send({ questionIds: [ids[2]] })).status).toBe(400);
    expect((await admin.put(order).send({ questionIds: [ids[2], ids[2]] })).status).toBe(400);
    expect((await admin.put(order).send({ questionIds: [ids[2], ids[0]] })).status).toBe(200);
    expect((await list(w.e2.id)).questions.map((q) => q.text)).toEqual(["C", "A"]);
  });

  it("once students have taken the exam, only wording can change", async () => {
    const q = (await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single("Before?"))).body as Question;
    await lock(w.e2.id);
    expect((await list(w.e2.id)).locked).toBe(true);

    const [right, wrong] = q.options;
    const reword = await admin.patch(`/api/catalog/questions/${q.id}`).send({
      text: "Reworded?",
      options: [
        { id: right?.id, text: "Correct", isCorrect: true },
        { id: wrong?.id, text: "Incorrect", isCorrect: false },
      ],
    });
    expect(reword.status).toBe(200);
    expect((reword.body as Question).options.map((o) => [o.text, o.isCorrect])).toEqual([
      ["Correct", true],
      ["Incorrect", false],
    ]);

    const refused = [
      admin.patch(`/api/catalog/questions/${q.id}`).send({ points: 5 }),
      admin.patch(`/api/catalog/questions/${q.id}`).send({
        options: [
          { id: right?.id, text: "Correct", isCorrect: false },
          { id: wrong?.id, text: "Incorrect", isCorrect: true },
        ],
      }),
      admin.delete(`/api/catalog/questions/${q.id}`).send({}),
      admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single("New?")),
    ];
    for (const res of await Promise.all(refused)) expect(res.status).toBe(409);
  });
});

describe("importing questions", () => {
  const url = () => `/api/catalog/exams/${w.e2.id}/questions/import`;

  it("dry run reports problems per question and writes nothing", async () => {
    const res = await admin
      .post(url())
      .send({ questions: [single("Fine?"), { type: "ESSAY", text: "x" }, { ...single("Bad?"), points: 0 }] });
    expect(res.status).toBe(200);
    const body = res.body as { dryRun: boolean; errors: { index: number }[]; imported: number };
    expect(body.dryRun).toBe(true);
    expect([...new Set(body.errors.map((e) => e.index))]).toEqual([2, 3]);
    expect((await list(w.e2.id)).questions).toHaveLength(0);
  });

  it("imports everything or nothing", async () => {
    const bad = await admin
      .post(url())
      .send({ dryRun: false, questions: [single("Fine?"), { ...single("Bad?"), options: [] }] });
    expect((bad.body as { imported: number }).imported).toBe(0);
    expect((await list(w.e2.id)).questions).toHaveLength(0);

    const good = await admin.post(url()).send({ dryRun: false, questions: [single("One?"), single("Two?")] });
    expect((good.body as { imported: number }).imported).toBe(2);
    expect((await list(w.e2.id)).questions.map((q) => q.text)).toEqual(["One?", "Two?"]);
  });
});

describe("publishing", () => {
  it("refuses an exam without valid questions and says why", async () => {
    const draft = await makeExam(db, w.networking, { status: "DRAFT" });
    const publish = () => admin.patch(`/api/catalog/exams/${draft.id}`).send({ status: "PUBLISHED" });
    const refused = await publish();
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "CONFLICT", details: ["Add at least one question."] });
    expect((await list(draft.id)).publishProblems).toEqual(["Add at least one question."]);

    await admin.post(`/api/catalog/exams/${draft.id}/questions`).send(single("Ready?"));
    expect((await publish()).status).toBe(200);
  });

  it("checks the settings sent in the same update", async () => {
    const draft = await makeExam(db, w.networking, { status: "DRAFT" });
    await admin.post(`/api/catalog/exams/${draft.id}/questions`).send(single("Ready?"));
    const res = await admin
      .patch(`/api/catalog/exams/${draft.id}`)
      .send({ status: "PUBLISHED", questionsPerAttempt: 5 });
    expect(res.status).toBe(409);
    // External exams have no questions: they publish as they are.
    const ctf = await makeExam(db, w.networking, { status: "DRAFT", isExternal: true });
    expect((await admin.patch(`/api/catalog/exams/${ctf.id}`).send({ status: "PUBLISHED" })).status).toBe(200);
  });
});

describe("materials", () => {
  it("adds, renames and removes https links; students see them", async () => {
    const url = `/api/catalog/exams/${w.e1.id}/materials`;
    expect((await admin.post(url).send({ title: "Insecure", url: "http://example.com" })).status).toBe(400);
    const m = (await admin.post(url).send({ title: "Slides", url: "https://example.com/slides" })).body as {
      id: string;
    };
    expect((await admin.patch(`/api/catalog/materials/${m.id}`).send({ title: "Slides v2" })).status).toBe(200);

    const student = await loginAs(app, w.users.student);
    const rows = (await student.get("/api/student/exams")).body as {
      exam: { id: string; materials: { title: string }[] };
    }[];
    expect(rows.find((r) => r.exam.id === w.e1.id)?.exam.materials).toEqual([
      { title: "Slides v2", url: "https://example.com/slides" },
    ]);

    expect((await admin.delete(`/api/catalog/materials/${m.id}`).send({})).status).toBe(204);
    expect((await admin.get(url)).body).toEqual([]);
  });
});

describe("duplicating", () => {
  it("copies settings, tags, questions and materials into a new draft", async () => {
    // E2 with a plain tag (an access tag would refuse an instructor, not the admin).
    await db.examTag.create({ data: { examId: w.e2.id, tagId: w.tagSpare.id } });
    await admin.post(`/api/catalog/exams/${w.e2.id}/questions`).send(single("Copied?"));
    await admin.post(`/api/catalog/exams/${w.e2.id}/materials`).send({ title: "Notes", url: "https://example.com/n" });
    await lock(w.e2.id);

    const res = await admin.post(`/api/catalog/exams/${w.e2.id}/duplicate`).send({ code: "e2-v2" });
    expect(res.status).toBe(201);
    const copyId = (res.body as { id: string }).id;
    const copy = (await admin.get(`/api/catalog/exams/${copyId}`)).body as {
      code: string;
      title: string;
      status: string;
      tags: { name: string }[];
    };
    expect(copy).toMatchObject({ code: "E2-V2", title: "E2 (copy)", status: "DRAFT" });
    expect(copy.tags.map((t) => t.name)).toEqual(["spare"]);
    const content = await list(copyId);
    expect(content.locked).toBe(false); // the copy has no attempts: fully editable
    expect(content.questions.map((q) => q.text)).toEqual(["Copied?"]);
    expect((await admin.get(`/api/catalog/exams/${copyId}/materials`)).body).toHaveLength(1);

    expect((await admin.post(`/api/catalog/exams/${w.e2.id}/duplicate`).send({ code: "E2-V2" })).status).toBe(409);
  });

  it("needs edit access to the whole category", async () => {
    const editor = await makeUser(db, { role: "INSTRUCTOR", username: "exam.only.editor" });
    await makeGrant(db, editor, { permissions: ["EXAM_EDIT"], examIds: [w.e1.id], allGroups: true });
    const agent = await loginAs(app, editor);
    expect((await agent.get(`/api/catalog/exams/${w.e1.id}/questions`)).status).toBe(200);
    expect((await agent.post(`/api/catalog/exams/${w.e1.id}/duplicate`).send({ code: "NOPE-1" })).status).toBe(403);
  });
});

it("students never receive the answer key", async () => {
  // E1 (assigned to the student's group) is locked, so the question is seeded directly.
  await db.question.create({
    data: {
      examId: w.e1.id,
      type: "SINGLE_CHOICE",
      text: "Secret?",
      position: 0,
      options: {
        create: [
          { text: "Right", isCorrect: true, position: 0 },
          { text: "Wrong", isCorrect: false, position: 1 },
        ],
      },
    },
  });
  const student = await loginAs(app, w.users.student);
  expect((await student.get(`/api/catalog/exams/${w.e1.id}/questions`)).status).toBe(403);
  expect(JSON.stringify((await student.get("/api/student/exams")).body)).not.toContain("isCorrect");
});

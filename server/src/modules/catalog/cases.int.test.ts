// Use-case exams: uploaded pictures, cases with picture options and written follow-ups, end to end
// (docs/CASE_QUESTIONS_PLAN.md).
import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { loginAs } from "../../test/http.js";
import { jpeg, png } from "../../test/images.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db, clock } = createTestApp();
let w: World;
let admin: request.Agent;
let student: request.Agent;

const NOW = "2026-11-08T10:00:00Z";

beforeEach(async () => {
  clock.set(NOW);
  await resetDb(db);
  w = await seedWorld(db, new Date(NOW));
  admin = await loginAs(app, w.users.superAdmin);
  student = await loginAs(app, w.users.student);
});
afterAll(() => db.$disconnect());

/** A question as the API returns it (staff or student shape: the fields these tests read). */
interface Row {
  id: string;
  caseId: string | null;
  position: number;
  answerSize: string;
  options: { id: string }[];
}
const qs = (body: unknown) => (body as { questions: Row[] }).questions;

const upload = (agent: request.Agent, examId: string, data: Buffer, type = "image/png") =>
  agent.post(`/api/uploads?examId=${examId}`).set("Content-Type", type).send(data);

async function newExam(code: string, extra: object = {}) {
  const res = await admin.post("/api/catalog/exams").send({
    code,
    title: "Operating System Fundamentals",
    durationMinutes: 60,
    categoryId: w.networking.id,
    type: "MCQ_ESSAY",
    shuffleQuestions: false,
    shuffleOptions: true,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** One loose question, then the "Boot sequence" case: a picture MCQ and two written follow-ups. */
async function buildUseCase(examId: string) {
  const pictures: string[] = [];
  for (let i = 0; i < 3; i++) pictures.push((await upload(admin, examId, png(2 + i, 2))).body.id as string);
  const loose = await admin.post(`/api/catalog/exams/${examId}/questions`).send({
    type: "ESSAY",
    text: "Introduce yourself.",
  });
  const c = await admin.post(`/api/catalog/exams/${examId}/cases`).send({
    label: "DESIGN",
    title: "Boot sequence",
    situation: "A junior asks what happens before the login screen.",
    hint: "Firmware first.",
    imageId: pictures[2],
    imageAlt: "A server rack",
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const mcq = await admin.post(`/api/catalog/exams/${examId}/questions`).send({
    type: "SINGLE_CHOICE",
    caseId: c.body.id,
    points: 2,
    text: "Which sequence is correct?",
    options: [
      {
        imageId: pictures[0],
        imageAlt: "Power, BIOS, bootloader, kernel, login",
        isCorrect: true,
        explanation: "Firmware first",
      },
      { imageId: pictures[1], imageAlt: "Power, bootloader, BIOS, kernel, login", isCorrect: false },
      { text: "Power, kernel, BIOS", detail: "Three steps", isCorrect: false },
    ],
  });
  expect(mcq.status, JSON.stringify(mcq.body)).toBe(201);
  const role = await admin.post(`/api/catalog/exams/${examId}/questions`).send({
    type: "ESSAY",
    caseId: c.body.id,
    text: "What is the role of BIOS/UEFI?",
    guidance: "Initialises hardware, finds the bootloader.",
  });
  const secure = await admin.post(`/api/catalog/exams/${examId}/questions`).send({
    type: "ESSAY",
    caseId: c.body.id,
    answerSize: "SHORT",
    text: "Name the feature that only runs signed bootloaders.",
  });
  return {
    caseId: c.body.id as string,
    pictures,
    loose: loose.body.id as string,
    mcq: mcq.body as { id: string; options: { id: string }[] },
    role: role.body.id as string,
    secure: secure.body.id as string,
  };
}

async function publishForGroupA(examId: string, extra: object = {}) {
  const res = await admin.patch(`/api/catalog/exams/${examId}`).send({ status: "PUBLISHED", ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await db.assignment.create({
    data: { examId, groupId: w.groupA.id, mode: "FIXED", opensAt: new Date("2026-11-08T09:00:00Z") },
  });
}

// ─────────────────────────────── Uploads ───────────────────────────────

describe("uploads", () => {
  it("stores a cleaned picture and serves it privately to staff", async () => {
    const examId = await newExam("UP-1");
    const res = await upload(admin, examId, png(3, 2, { text: "author: someone", trailer: "<html>" }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ mime: "image/png", width: 3, height: 2, url: `/api/uploads/${res.body.id}` });

    const got = await admin.get(res.body.url).buffer(true);
    expect(got.status).toBe(200);
    expect(got.headers).toMatchObject({
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    expect((got.body as Buffer).toString("latin1")).not.toContain("author");
    expect((got.body as Buffer).toString("latin1")).not.toContain("<html>");

    const audit = await db.auditLog.findFirst({ where: { action: "uploads.created" } });
    expect(audit?.detail).toMatchObject({ uploadId: res.body.id, mime: "image/png" });
  });

  it("judges files by their bytes, not their declared type", async () => {
    const examId = await newExam("UP-2");
    const fake = await upload(admin, examId, Buffer.from("<script>alert(1)</script>"), "image/png");
    expect(fake.status).toBe(400);
    expect(fake.body.message).toMatch(/PNG, JPEG or WebP/);
    // A real JPEG sent as PNG is stored as what it is.
    const jpg = await upload(admin, examId, jpeg(10, 20), "image/png");
    expect(jpg.body).toMatchObject({ mime: "image/jpeg", width: 10, height: 20 });
    // Other content types never reach the handler.
    const gif = await admin.post(`/api/uploads?examId=${examId}`).set("Content-Type", "image/gif").send("GIF89a");
    expect(gif.status).toBe(415);
  });

  it("refuses pictures larger than 2 MB", async () => {
    const examId = await newExam("UP-3");
    const res = await upload(admin, examId, Buffer.concat([png(), Buffer.alloc(2_200_000)]));
    expect(res.status).toBe(413);
  });

  it("a picture from another exam can't be used", async () => {
    const a = await newExam("UP-4");
    const b = await newExam("UP-5");
    const picture = (await upload(admin, a, png())).body.id as string;
    const res = await admin.post(`/api/catalog/exams/${b}/questions`).send({
      type: "ESSAY",
      text: "Describe the picture.",
      imageId: picture,
      imageAlt: "A diagram",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Upload the picture to this exam first/);
  });
});

// ─────────────────────────────── Editing ───────────────────────────────

describe("building a use case", () => {
  it("keeps a case's questions together, after the loose question", async () => {
    const examId = await newExam("UC-1");
    const uc = await buildUseCase(examId);
    // A loose question added later goes to the end, not inside the case.
    const last = await admin
      .post(`/api/catalog/exams/${examId}/questions`)
      .send({ type: "ESSAY", text: "Anything else?" });

    const list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(qs(list.body).map((q: { id: string }) => q.id)).toEqual([
      uc.loose,
      uc.mcq.id,
      uc.role,
      uc.secure,
      last.body.id,
    ]);
    expect(list.body.cases).toEqual([
      {
        id: uc.caseId,
        label: "DESIGN",
        title: "Boot sequence",
        situation: "A junior asks what happens before the login screen.",
        hint: "Firmware first.",
        imageId: uc.pictures[2],
        imageAlt: "A server rack",
      },
    ]);
    expect(list.body.questions[1].options[0]).toMatchObject({
      text: "",
      imageId: uc.pictures[0],
      imageAlt: "Power, BIOS, bootloader, kernel, login",
      explanation: "Firmware first",
    });
    expect(list.body.questions[3].answerSize).toBe("SHORT");
    expect(list.body.publishProblems).toEqual([]);

    // Splitting the case is refused; moving the whole case is fine.
    const split = await admin
      .put(`/api/catalog/exams/${examId}/questions/order`)
      .send({ questionIds: [uc.mcq.id, uc.loose, uc.role, uc.secure, last.body.id] });
    expect(split.status).toBe(400);
    expect(split.body.message).toMatch(/Keep the questions of a case together/);
    const moved = await admin
      .put(`/api/catalog/exams/${examId}/questions/order`)
      .send({ questionIds: [uc.mcq.id, uc.role, uc.secure, uc.loose, last.body.id] });
    expect(moved.status).toBe(200);

    // Taking a question out of its case puts it right after the case.
    await admin.patch(`/api/catalog/questions/${uc.role}`).send({ caseId: null });
    const after = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(qs(after.body).map((q: { id: string }) => q.id)).toEqual([
      uc.mcq.id,
      uc.secure,
      uc.role,
      uc.loose,
      last.body.id,
    ]);
  });

  it("an empty case blocks publishing; deleting a case deletes its questions", async () => {
    const examId = await newExam("UC-2");
    const uc = await buildUseCase(examId);
    const empty = await admin
      .post(`/api/catalog/exams/${examId}/cases`)
      .send({ title: "Permissions", situation: "ls -la shows -rw-r-----" });
    const publish = await admin.patch(`/api/catalog/exams/${examId}`).send({ status: "PUBLISHED" });
    expect(publish.status).toBe(409);
    expect(publish.body.details).toEqual(["Case “Permissions” has no questions: add some or delete it."]);

    expect((await admin.delete(`/api/catalog/cases/${empty.body.id}`).send({})).status).toBe(204);
    expect((await admin.delete(`/api/catalog/cases/${uc.caseId}`).send({})).status).toBe(204);
    const list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(qs(list.body).map((q: { id: string; position: number }) => [q.id, q.position])).toEqual([[uc.loose, 0]]);
    expect(list.body.cases).toEqual([]);
  });

  it("a picture needs alt text; a case picture too", async () => {
    const examId = await newExam("UC-3");
    const picture = (await upload(admin, examId, png())).body.id as string;
    const q = await admin.post(`/api/catalog/exams/${examId}/questions`).send({
      type: "SINGLE_CHOICE",
      text: "Pick one",
      options: [
        { imageId: picture, isCorrect: true },
        { text: "b", isCorrect: false },
      ],
    });
    expect(q.status).toBe(400);
    expect(q.body.message).toMatch(/alt text/);
    const c = await admin
      .post(`/api/catalog/exams/${examId}/cases`)
      .send({ title: "T", situation: "S", imageId: picture });
    expect(c.status).toBe(400);
  });
});

// ─────────────────────────────── Taking it ───────────────────────────────

describe("taking a use case", () => {
  it("delivers the case whole, with pictures and letters but no answer key", async () => {
    const examId = await newExam("UC-10", { intro: "The story so far: TechBridge…" });
    const uc = await buildUseCase(examId);
    await publishForGroupA(examId);

    const brief = await student.get(`/api/student/exams/${examId}`);
    expect(brief.body.exam.intro).toBe("The story so far: TechBridge…");

    const start = await student.post("/api/attempts").send({ examId });
    expect(start.status).toBe(201);
    const view = start.body;
    expect(view.exam.intro).toBe("The story so far: TechBridge…");
    expect(view.cases).toEqual([
      {
        id: uc.caseId,
        label: "DESIGN",
        title: "Boot sequence",
        situation: "A junior asks what happens before the login screen.",
        hint: null, // hints are off by default
        imageUrl: `/api/uploads/${uc.pictures[2]}`,
        imageAlt: "A server rack",
      },
    ]);
    const mcq = qs(view).find((q) => q.id === uc.mcq.id)!;
    expect(mcq.caseId).toBe(uc.caseId);
    // shuffleOptions is on, but options inside a case keep their order (and letters).
    expect(mcq.options.map((o) => o.id)).toEqual(uc.mcq.options.map((o) => o.id));
    expect(mcq.options[0]).toEqual({
      id: uc.mcq.options[0]?.id,
      text: "",
      detail: null,
      imageUrl: `/api/uploads/${uc.pictures[0]}`,
      imageAlt: "Power, BIOS, bootloader, kernel, login",
    });
    expect(mcq.options[2]).toMatchObject({ text: "Power, kernel, BIOS", detail: "Three steps", imageUrl: null });
    const json = JSON.stringify(view);
    expect(json).not.toContain("isCorrect");
    expect(json).not.toContain("Firmware first"); // neither the explanation nor the hint
    expect(json).not.toContain("Initialises hardware"); // nor grader guidance
    expect(qs(view).find((q) => q.id === uc.secure)?.answerSize).toBe("SHORT");

    // Pictures load during the attempt; one not used by the exam does not.
    expect((await student.get(`/api/uploads/${uc.pictures[0]}`)).status).toBe(200);
    const unused = (await upload(admin, examId, png(9, 9))).body.id as string;
    expect((await student.get(`/api/uploads/${unused}`)).status).toBe(404);

    // Short answers are capped at 300 characters.
    const save = (questionId: string, body: object) =>
      student.put(`/api/attempts/${view.attemptId}/answers/${questionId}`).send(body);
    expect((await save(uc.secure, { text: "x".repeat(301) })).status).toBe(400);
    expect((await save(uc.secure, { text: "Secure Boot" })).status).toBe(200);
    expect((await save(uc.role, { text: "x".repeat(2000) })).status).toBe(200);

    // After submitting, the pictures are no longer available to the student.
    await student.post(`/api/attempts/${view.attemptId}/submit`).send({});
    expect((await student.get(`/api/uploads/${uc.pictures[0]}`)).status).toBe(404);
  });

  it("sends hints only when the exam shows them", async () => {
    const examId = await newExam("UC-11", { showHints: true });
    await buildUseCase(examId);
    await publishForGroupA(examId);
    const start = await student.post("/api/attempts").send({ examId });
    expect(start.body.cases[0].hint).toBe("Firmware first.");
  });

  it("without back navigation, the whole current case stays open", async () => {
    const examId = await newExam("UC-12", { allowBackNavigation: false });
    const uc = await buildUseCase(examId);
    await publishForGroupA(examId);
    const { body: view } = await student.post("/api/attempts").send({ examId });
    const save = (questionId: string, body: object) =>
      student.put(`/api/attempts/${view.attemptId}/answers/${questionId}`).send(body);

    // Order: loose (0), then the case (1..3).
    expect((await student.post(`/api/attempts/${view.attemptId}/position`).send({ index: 1 })).status).toBe(200);
    expect((await save(uc.loose, { text: "late" })).status).toBe(409); // the loose question is closed
    expect((await save(uc.secure, { text: "Secure Boot" })).status).toBe(200); // last question of the case
    expect((await save(uc.mcq.id, { selectedOptionIds: [uc.mcq.options[0]?.id] })).status).toBe(200); // same case
    const resumed = await student.get(`/api/attempts/${view.attemptId}`);
    expect(qs(resumed.body).map((q: { id: string }) => q.id)).toEqual([uc.mcq.id, uc.role, uc.secure]);
    expect(resumed.body.cases).toHaveLength(1);
  });
});

// ─────────────────────────────── Grading, locking, copying ───────────────────────────────

describe("after students take it", () => {
  async function taken() {
    const examId = await newExam("UC-20");
    const uc = await buildUseCase(examId);
    await publishForGroupA(examId);
    const { body: view } = await student.post("/api/attempts").send({ examId });
    await student
      .put(`/api/attempts/${view.attemptId}/answers/${uc.mcq.id}`)
      .send({ selectedOptionIds: [uc.mcq.options[1]?.id] });
    await student.post(`/api/attempts/${view.attemptId}/submit`).send({});
    return { examId, uc, attemptId: view.attemptId as string };
  }

  it("the grader sees the case, the pictures and the explanations, in the student's order", async () => {
    const { uc, attemptId } = await taken();
    const res = await admin.get(`/api/grading/attempts/${attemptId}`);
    expect(res.status).toBe(200);
    expect(res.body.cases).toEqual([expect.objectContaining({ id: uc.caseId, hint: "Firmware first." })]);
    const mcq = qs(res.body).find((q) => q.id === uc.mcq.id) as Row & { options: object[]; autoPoints: number | null };
    expect(mcq.caseId).toBe(uc.caseId);
    expect(mcq.options[0]).toMatchObject({ isCorrect: true, explanation: "Firmware first", selected: false });
    expect(mcq.options[1]).toMatchObject({
      isCorrect: false,
      selected: true,
      imageUrl: `/api/uploads/${uc.pictures[1]}`,
    });
    expect(mcq.autoPoints).toBe(0);
    expect((await admin.get(`/api/uploads/${uc.pictures[1]}`)).status).toBe(200);
  });

  it("locks structure but allows wording, pictures and explanations", async () => {
    const { examId, uc } = await taken();
    expect((await admin.patch(`/api/catalog/cases/${uc.caseId}`).send({ situation: "Reworded." })).status).toBe(200);
    expect((await admin.delete(`/api/catalog/cases/${uc.caseId}`).send({})).status).toBe(409);
    expect((await admin.post(`/api/catalog/exams/${examId}/cases`).send({ title: "T", situation: "S" })).status).toBe(
      409,
    );
    expect((await admin.patch(`/api/catalog/questions/${uc.role}`).send({ caseId: null })).status).toBe(409);
    expect((await admin.patch(`/api/catalog/questions/${uc.secure}`).send({ answerSize: "LONG" })).status).toBe(409);

    const list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    const options = qs(list.body).find((q) => q.id === uc.mcq.id)!.options;
    const replacement = (await upload(admin, examId, png(7, 7))).body.id as string;
    const reword = await admin.patch(`/api/catalog/questions/${uc.mcq.id}`).send({
      options: options.map((o, i) => ({
        ...o,
        ...(i === 1
          ? { imageId: replacement, imageAlt: "Redrawn", explanation: "BIOS can't come after the bootloader" }
          : {}),
      })),
    });
    expect(reword.status, JSON.stringify(reword.body)).toBe(200);
    expect(reword.body.options[1]).toMatchObject({ imageId: replacement, imageAlt: "Redrawn" });
  });

  it("a copy keeps the cases and shares the pictures", async () => {
    const { examId, uc } = await taken();
    const copy = await admin.post(`/api/catalog/exams/${examId}/duplicate`).send({ code: "UC-20-B" });
    expect(copy.status).toBe(201);
    const list = await admin.get(`/api/catalog/exams/${copy.body.id}/questions`);
    expect(list.body.locked).toBe(false);
    expect(list.body.cases).toHaveLength(1);
    expect(list.body.cases[0].id).not.toBe(uc.caseId);
    expect(qs(list.body).filter((q) => q.caseId === list.body.cases[0].id)).toHaveLength(3);
    expect(list.body.questions[1].options[0]).toMatchObject({ imageId: uc.pictures[0], explanation: "Firmware first" });
    // The copy may keep using (and re-save) the shared picture.
    const resave = await admin
      .patch(`/api/catalog/questions/${list.body.questions[1].id}`)
      .send({ options: list.body.questions[1].options });
    expect(resave.status, JSON.stringify(resave.body)).toBe(200);
  });
});

describe("import", () => {
  it("imports loose questions and cases, all or nothing", async () => {
    const examId = await newExam("UC-30");
    const picture = (await upload(admin, examId, png())).body.id as string;
    const body = {
      questions: [{ type: "ESSAY", text: "Warm-up" }],
      cases: [
        {
          label: "KNOWLEDGE",
          title: "OS type selection",
          situation: "Ahmed is deploying a web server.",
          questions: [
            {
              type: "SINGLE_CHOICE",
              text: "Which OS?",
              points: 2,
              options: [
                { text: "Windows 10 Home", detail: "Consumer desktop OS", isCorrect: false },
                { text: "Linux Server", isCorrect: true, imageId: picture, imageAlt: "Tux" },
              ],
            },
            { type: "ESSAY", answerSize: "SHORT", text: "Name one web server." },
          ],
        },
      ],
    };
    const dry = await admin.post(`/api/catalog/exams/${examId}/questions/import`).send(body);
    expect(dry.body).toMatchObject({ dryRun: true, errors: [], imported: 0 });

    const bad = await admin.post(`/api/catalog/exams/${examId}/questions/import`).send({
      ...body,
      dryRun: false,
      cases: [{ ...body.cases[0], questions: [{ type: "SINGLE_CHOICE", text: "x", options: [] }] }],
    });
    expect(bad.body.imported).toBe(0);
    expect(bad.body.errors[0].message).toMatch(/^Case 1: question 1: /);

    const real = await admin.post(`/api/catalog/exams/${examId}/questions/import`).send({ ...body, dryRun: false });
    expect(real.body).toMatchObject({ dryRun: false, errors: [], imported: 3 });
    const list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(list.body.cases[0]).toMatchObject({ label: "KNOWLEDGE", title: "OS type selection" });
    expect(qs(list.body).map((q: { caseId: string | null }) => q.caseId)).toEqual([
      null,
      list.body.cases[0].id,
      list.body.cases[0].id,
    ]);
  });
});

describe("refusals", () => {
  it("a question can't join another exam's case or change to a type the exam doesn't allow", async () => {
    const a = await newExam("RF-1");
    const b = await newExam("RF-2", { type: "MCQ" });
    const c = await newExam("RF-2B");
    const uc = await buildUseCase(a);
    const q = await admin.post(`/api/catalog/exams/${b}/questions`).send({
      type: "TRUE_FALSE",
      text: "T?",
      options: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
    });
    expect(
      (await admin.post(`/api/catalog/exams/${c}/questions`).send({ type: "ESSAY", text: "x", caseId: uc.caseId })).body
        .message,
    ).toMatch(/isn't part of this exam/);
    const essay = await admin.patch(`/api/catalog/questions/${q.body.id}`).send({ type: "ESSAY", options: [] });
    expect(essay.status).toBe(400);
  });

  it("moves a question into a case, and out of an emptied case", async () => {
    const examId = await newExam("RF-3");
    const uc = await buildUseCase(examId);
    // Into the case: after its last question.
    await admin.patch(`/api/catalog/questions/${uc.loose}`).send({ caseId: uc.caseId });
    let list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(qs(list.body).map((q) => q.id)).toEqual([uc.mcq.id, uc.role, uc.secure, uc.loose]);
    // A second case with one question; taking it out leaves the question where it was.
    const other = await admin.post(`/api/catalog/exams/${examId}/cases`).send({ title: "Other", situation: "S" });
    await admin.patch(`/api/catalog/questions/${uc.loose}`).send({ caseId: other.body.id });
    await admin.patch(`/api/catalog/questions/${uc.loose}`).send({ caseId: null });
    list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(qs(list.body).map((q) => [q.id, q.caseId])).toEqual([
      [uc.mcq.id, uc.caseId],
      [uc.role, uc.caseId],
      [uc.secure, uc.caseId],
      [uc.loose, null],
    ]);
  });

  it("picture descriptions stay required when editing, even on a locked exam", async () => {
    const examId = await newExam("RF-4");
    const uc = await buildUseCase(examId);
    expect((await admin.patch(`/api/catalog/cases/${uc.caseId}`).send({ imageAlt: null })).status).toBe(400);
    await publishForGroupA(examId);
    await student.post("/api/attempts").send({ examId });
    const list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    const options = (qs(list.body).find((q) => q.id === uc.mcq.id)!.options as object[]).map((o, i) =>
      i === 0 ? { ...o, imageAlt: null } : o,
    );
    const res = await admin.patch(`/api/catalog/questions/${uc.mcq.id}`).send({ options });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/alt text/);
  });

  it("an import reports bad cases, case pictures without alt text, stray caseIds and unknown pictures", async () => {
    const examId = await newExam("RF-5");
    const res = await admin.post(`/api/catalog/exams/${examId}/questions/import`).send({
      questions: [{ type: "ESSAY", text: "Q", imageId: "00000000-0000-4000-8000-000000000001", imageAlt: "x" }],
      cases: [
        { situation: "no title" },
        "just text",
        {
          title: "T",
          situation: "S",
          imageId: "00000000-0000-4000-8000-000000000002",
          questions: [{ type: "ESSAY", text: "Q2", caseId: "00000000-0000-4000-8000-000000000003" }],
        },
      ],
    });
    const messages = (res.body.errors as { message: string }[]).map((e) => e.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Case 1: title: /),
        "Case 3: Describe the case's picture (alt text).",
        expect.stringMatching(/^Case 3: question 1: caseId: leave it out/),
        expect.stringMatching(/^Case 2: case: /),
        "A picture isn't uploaded to this exam: upload it first and use its id.",
      ]),
    );
  });
});

describe("editing pictures and guidance", () => {
  it("before and after students take the exam", async () => {
    const examId = await newExam("PG-1");
    const uc = await buildUseCase(examId);
    const pic = (await upload(admin, examId, png(5, 5))).body.id as string;
    const before = await admin
      .patch(`/api/catalog/questions/${uc.role}`)
      .send({ imageId: pic, imageAlt: "A diagram", guidance: "Model answer 2" });
    expect(before.body).toMatchObject({ imageId: pic, imageAlt: "A diagram", guidance: "Model answer 2" });
    const c = await admin.patch(`/api/catalog/cases/${uc.caseId}`).send({ imageId: pic, imageAlt: "Rack" });
    expect(c.body).toMatchObject({ imageId: pic, imageAlt: "Rack" });

    await publishForGroupA(examId);
    await student.post("/api/attempts").send({ examId });
    const after = await admin
      .patch(`/api/catalog/questions/${uc.role}`)
      .send({ imageId: null, imageAlt: "ignored", guidance: "Model answer 3" });
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ imageId: null, imageAlt: null, guidance: "Model answer 3" });
    const alt = await admin.patch(`/api/catalog/questions/${uc.mcq.id}`).send({ text: "Which order is right?" });
    expect(alt.body.text).toBe("Which order is right?");
  });

  it("an import may hold only cases, with a case picture", async () => {
    const examId = await newExam("PG-2");
    const picture = (await upload(admin, examId, png())).body.id as string;
    const res = await admin.post(`/api/catalog/exams/${examId}/questions/import`).send({
      dryRun: false,
      cases: [
        {
          title: "T",
          situation: "S",
          imageId: picture,
          imageAlt: "Network map",
          questions: [{ type: "ESSAY", text: "Describe it." }],
        },
      ],
    });
    expect(res.body).toMatchObject({ errors: [], imported: 1 });
    const list = await admin.get(`/api/catalog/exams/${examId}/questions`);
    expect(list.body.cases[0]).toMatchObject({ imageId: picture, imageAlt: "Network map" });
    const empty = await admin.post(`/api/catalog/exams/${examId}/questions/import`).send({});
    expect(empty.status).toBe(400);
  });
});

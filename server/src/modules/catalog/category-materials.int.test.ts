// Materials of a whole category (docs/FIXES_PLAN.md fix 2): staff page, student page, edit rights.
import type request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam } from "../../test/factories.js";
import { loginAs } from "../../test/http.js";
import { seedWorld, type World } from "../../test/rbac-world.js";

const { app, db, clock } = createTestApp();
let w: World;
let admin: request.Agent;

const NOW = "2026-11-17T10:00:00Z";
const link = (title: string) => ({ title, url: `https://example.com/${title.toLowerCase().replace(/\W+/g, "-")}` });

interface Section {
  category: { id: string; name: string };
  canEdit: boolean;
  materials: { id: string; title: string; url: string; position: number }[];
}
interface StudentSection {
  category: { id: string; name: string };
  materials: { title: string; url: string }[];
  exams: { id: string; title: string; materials: { title: string; url: string }[] }[];
}

beforeEach(async () => {
  clock.set(NOW);
  await resetDb(db);
  w = await seedWorld(db, new Date(NOW));
  admin = await loginAs(app, w.users.superAdmin);
});
afterAll(() => db.$disconnect());

describe("category materials, staff side", () => {
  it("adds links to a category, in order, audited on the category; edits and removes them", async () => {
    const a = await admin.post(`/api/catalog/categories/${w.networking.id}/materials`).send(link("Reading list"));
    expect(a.status).toBe(201);
    const b = await admin.post(`/api/catalog/categories/${w.networking.id}/materials`).send(link("Slides"));
    expect(b.body.position).toBe(1);

    const sections = (await admin.get("/api/catalog/materials")).body as Section[];
    const net = sections.find((s) => s.category.id === w.networking.id);
    expect(net).toMatchObject({ canEdit: true, materials: [{ title: "Reading list" }, { title: "Slides" }] });
    expect(sections.map((s) => s.category.id)).toEqual(expect.arrayContaining([w.cloud.id, w.unusedCategory.id]));

    expect((await admin.patch(`/api/catalog/materials/${a.body.id}`).send({ title: "Reading" })).status).toBe(200);
    expect((await admin.delete(`/api/catalog/materials/${b.body.id}`).send({})).status).toBe(204);
    const after = ((await admin.get("/api/catalog/materials")).body as Section[]).find(
      (s) => s.category.id === w.networking.id,
    );
    expect(after?.materials.map((m) => m.title)).toEqual(["Reading"]);

    const log = await db.auditLog.findMany({ where: { entityType: "Category", entityId: w.networking.id } });
    expect(log.map((l) => l.action).sort()).toEqual(
      [
        "catalog.material_created",
        "catalog.material_created",
        "catalog.material_deleted",
        "catalog.material_updated",
      ].sort(),
    );
  });

  it("shows instructors the categories they reach, editable only with EXAM_EDIT on the category", async () => {
    await admin.post(`/api/catalog/categories/${w.networking.id}/materials`).send(link("Net notes"));
    const as = async (u: (typeof w.users)[keyof typeof w.users]) =>
      ((await (await loginAs(app, u)).get("/api/catalog/materials")).body as Section[]).map((s) => [
        s.category.id,
        s.canEdit,
      ]);

    expect(await as(w.users.instCategory)).toEqual([[w.cloud.id, true]]);
    // RESULTS_VIEW on E1 (Networking): reads Networking's links, can't change them.
    expect(await as(w.users.instExamA)).toEqual([[w.networking.id, false]]);
    expect(await as(w.users.instNone)).toEqual([]);

    const inst = await loginAs(app, w.users.instExamA);
    expect((await inst.post(`/api/catalog/categories/${w.networking.id}/materials`).send(link("X"))).status).toBe(404);
    const cloudLink = await (
      await loginAs(app, w.users.instCategory)
    )
      .post(`/api/catalog/categories/${w.cloud.id}/materials`)
      .send(link("Cloud"));
    expect(cloudLink.status).toBe(201);
    // Editing a category's link needs the rights on that category.
    expect((await inst.patch(`/api/catalog/materials/${cloudLink.body.id}`).send({ title: "Y" })).status).toBe(404);
  });

  it("refuses a link that isn't https, and an unknown category", async () => {
    const bad = await admin
      .post(`/api/catalog/categories/${w.networking.id}/materials`)
      .send({ title: "Plain", url: "http://example.com" });
    expect(bad.status).toBe(400);
    const missing = await admin
      .post("/api/catalog/categories/00000000-0000-4000-8000-000000000000/materials")
      .send(link("Lost"));
    expect(missing.status).toBe(404);
  });

  it("allows only one owner per material: an exam or a category", async () => {
    await expect(
      db.material.create({ data: { examId: w.e1.id, categoryId: w.networking.id, ...link("Both") } }),
    ).rejects.toThrow();
    await expect(db.material.create({ data: link("Neither") })).rejects.toThrow();
  });
});

describe("category materials, student side", () => {
  it("lists the categories of published exams assigned to the student, with each exam's own links", async () => {
    // Student A has E1 (Networking) through group A. E3 (Cloud) is group B's.
    await admin.post(`/api/catalog/categories/${w.networking.id}/materials`).send(link("Net notes"));
    await admin.post(`/api/catalog/categories/${w.cloud.id}/materials`).send(link("Cloud notes"));
    await admin.post(`/api/catalog/exams/${w.e1.id}/materials`).send(link("E1 slides"));
    // A draft in the Unused category, assigned to group A: not enough to see its category.
    const draft = await makeExam(db, w.unusedCategory, { status: "DRAFT" });
    await db.assignment.create({ data: { examId: draft.id, groupId: w.groupA.id, mode: "MANUAL" } });
    await admin.post(`/api/catalog/categories/${w.unusedCategory.id}/materials`).send(link("Hidden"));

    const student = await loginAs(app, w.users.student);
    const res = await student.get("/api/student/materials");
    expect(res.status).toBe(200);
    const sections = res.body as StudentSection[];
    expect(sections).toEqual([
      {
        category: { id: w.networking.id, name: w.networking.name },
        materials: [{ title: "Net notes", url: "https://example.com/net-notes" }],
        exams: [
          {
            id: w.e1.id,
            code: w.e1.code,
            title: w.e1.title,
            materials: [{ title: "E1 slides", url: "https://example.com/e1-slides" }],
          },
        ],
      },
    ]);

    const studentB = await loginAs(app, w.studentB);
    const b = (await studentB.get("/api/student/materials")).body as StudentSection[];
    expect(b.map((s) => s.category.id)).toContain(w.cloud.id);
    expect(b.map((s) => s.category.id)).not.toContain(w.unusedCategory.id);
  });

  it("is empty when no category of the student's exams has links", async () => {
    const student = await loginAs(app, w.users.student);
    expect((await student.get("/api/student/materials")).body).toEqual([]);
  });
});

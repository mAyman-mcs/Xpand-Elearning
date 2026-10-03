import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, resetDb } from "../../test/app.js";
import { makeExam, makeGrant, makeTag } from "../../test/factories.js";
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

interface ExamList {
  items: { id: string; title: string; tags: { name: string }[] }[];
  nextCursor: string | null;
  total: number;
}
const titles = (res: request.Response) => (res.body as ExamList).items.map((e) => e.title).sort();

describe("categories and tags", () => {
  it("rejects duplicate names regardless of case", async () => {
    expect((await admin.post("/api/catalog/categories").send({ name: "CLOUD" })).status).toBe(409);
    expect((await admin.post("/api/catalog/tags").send({ name: "Core" })).status).toBe(409);
    expect((await admin.patch(`/api/catalog/tags/${w.tagCore.id}`).send({ name: "CORE" })).status).toBe(200);
  });

  it("generates stable slugs, with a fallback for non-Latin names", async () => {
    const latin = (await admin.post("/api/catalog/categories").send({ name: "Operating Systems" })).body as {
      slug: string;
    };
    expect(latin.slug).toBe("operating-systems");
    const arabic = (await admin.post("/api/catalog/tags").send({ name: "اختبار نهائي" })).body as {
      slug: string;
      name: string;
    };
    expect(arabic.name).toBe("اختبار نهائي");
    expect(arabic.slug).toMatch(/^x-[0-9a-f]{6}$/);

    const renamed = (await admin.patch(`/api/catalog/categories/${w.cloud.id}`).send({ name: "Cloud Gates" })).body as {
      slug: string;
    };
    expect(renamed.slug).toBe("cloud"); // renaming keeps links working
  });

  it("refuses to delete a category in use; archiving hides it and blocks new exams", async () => {
    expect((await admin.delete(`/api/catalog/categories/${w.cloud.id}`).send({})).status).toBe(409);

    await admin.patch(`/api/catalog/categories/${w.cloud.id}`).send({ archived: true });
    const visible = (await admin.get("/api/catalog/categories")).body as { name: string }[];
    expect(visible.map((c) => c.name)).not.toContain("Cloud");
    const all = (await admin.get("/api/catalog/categories?includeArchived=true")).body as {
      name: string;
      examCount: number;
    }[];
    expect(all.find((c) => c.name === "Cloud")).toMatchObject({ examCount: 1 });

    const res = await admin
      .post("/api/catalog/exams")
      .send({ code: "C-NEW", title: "New", categoryId: w.cloud.id, durationMinutes: 30 });
    expect(res.status).toBe(400);
  });

  it("deleting a tag removes it from exams and records how many", async () => {
    await admin.delete(`/api/catalog/tags/${w.tagCore.id}`).send({});
    expect((await admin.get(`/api/catalog/exams/${w.e1.id}`)).body.tags).toEqual([]);
    const entry = await db.auditLog.findFirst({ where: { action: "catalog.tag_deleted" } });
    expect(entry?.detail).toEqual({ name: "core", removedFromExams: 1 });
  });
});

describe("exams", () => {
  it("creates an exam with defaults, normalised code and tags", async () => {
    const res = await admin.post("/api/catalog/exams").send({
      code: "os-fund",
      title: "OS Fundamentals",
      categoryId: w.networking.id,
      durationMinutes: 45,
      tagIds: [w.tagCore.id],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: "OS-FUND",
      status: "DRAFT",
      passMark: 80,
      weight: 15,
      maxAttempts: 1,
      strikeLimit: 3,
      category: { id: w.networking.id, slug: "networking" },
      tags: [{ name: "core" }],
    });
    expect(
      (
        await admin
          .post("/api/catalog/exams")
          .send({ code: "OS-FUND", title: "X", categoryId: w.networking.id, durationMinutes: 5 })
      ).status,
    ).toBe(409);
  });

  it("updates only the fields sent", async () => {
    const res = await admin.patch(`/api/catalog/exams/${w.e1.id}`).send({ durationMinutes: 50, status: "ARCHIVED" });
    expect(res.body).toMatchObject({ title: "E1", durationMinutes: 50, status: "ARCHIVED", passMark: 80 });
    const entry = await db.auditLog.findFirst({ where: { action: "catalog.exam_updated" } });
    expect(entry?.detail).toEqual({
      changes: { durationMinutes: { from: 30, to: 50 }, status: { from: "PUBLISHED", to: "ARCHIVED" } },
    });
  });

  it("replaces tags idempotently and audits only real changes", async () => {
    const midterm = await makeTag(db, { name: "midterm" });
    const put = (tagIds: string[]) => admin.put(`/api/catalog/exams/${w.e1.id}/tags`).send({ tagIds });
    const tagNames = (res: request.Response) => (res.body as ExamList["items"][number]).tags.map((t) => t.name);
    expect(tagNames(await put([midterm.id, w.tagCore.id]))).toEqual(["core", "midterm"]);
    await put([midterm.id, w.tagCore.id]);
    expect((await put([midterm.id])).body.tags).toHaveLength(1);
    expect((await put([w.e2.id])).status).toBe(400); // not a tag

    const entries = await db.auditLog.findMany({ where: { action: "catalog.exam_tags_set" }, orderBy: { id: "asc" } });
    expect(entries.map((e) => e.detail)).toEqual([
      { added: [midterm.id], removed: [] },
      { added: [], removed: [w.tagCore.id] },
    ]);
  });
});

describe("moving exams between categories", () => {
  it("needs EXAM_EDIT on both the source and the destination", async () => {
    const inst = await loginAs(app, w.users.instCategory); // EXAM_EDIT on Cloud only
    const toNetworking = await inst.patch(`/api/catalog/exams/${w.e3.id}`).send({ categoryId: w.networking.id });
    expect(toNetworking.status).toBe(403);

    await makeGrant(db, w.users.instCategory, {
      permissions: ["EXAM_EDIT"],
      categoryIds: [w.networking.id],
      allGroups: true,
    });
    const moved = await inst.patch(`/api/catalog/exams/${w.e3.id}`).send({ categoryId: w.networking.id });
    expect(moved.status).toBe(200);
    expect(moved.body.category.slug).toBe("networking");
  });

  it("a category grant follows exams moved out of it", async () => {
    const inst = await loginAs(app, w.users.instCategory);
    expect((await inst.get(`/api/catalog/exams/${w.e3.id}`)).status).toBe(200);
    await admin.patch(`/api/catalog/exams/${w.e3.id}`).send({ categoryId: w.networking.id });
    expect((await inst.get(`/api/catalog/exams/${w.e3.id}`)).status).toBe(404);
  });
});

describe("listing exams (scope, filters, pagination)", () => {
  it("a category grant automatically includes exams created later (D5)", async () => {
    const inst = await loginAs(app, w.users.instCategory);
    expect(titles(await inst.get("/api/catalog/exams"))).toEqual(["E3"]);
    await makeExam(db, w.cloud, { title: "E4 (new)" });
    expect(titles(await inst.get("/api/catalog/exams"))).toEqual(["E3", "E4 (new)"]);
  });

  it.each([
    ["superAdmin", ["E1", "E2", "E3"]],
    ["instExamA", ["E1"]],
    ["instSplit", ["E1", "E2"]],
    ["instNone", []],
    ["instExpired", []],
  ] as const)("%s sees only exams in reach", async (actor, expected) => {
    const res = await (await loginAs(app, w.users[actor])).get("/api/catalog/exams");
    expect(titles(res)).toEqual(expected);
    expect((res.body as ExamList).total).toBe(expected.length);
  });

  it("applies filters inside the scope, never instead of it", async () => {
    const inst = await loginAs(app, w.users.instExamA);
    expect(titles(await inst.get(`/api/catalog/exams?categoryId=${w.cloud.id}`))).toEqual([]);
    expect(titles(await inst.get(`/api/catalog/exams?categoryId=${w.networking.id}`))).toEqual(["E1"]);
  });

  it("requires every requested tag (AND), and combines with text search", async () => {
    const midterm = await makeTag(db, { name: "midterm" });
    await makeExam(db, w.networking, { title: "Routing", tags: [w.tagCore, midterm] });
    await makeExam(db, w.cloud, { title: "Storage", tags: [midterm] });

    expect(titles(await admin.get(`/api/catalog/exams?tagIds=${w.tagCore.id}`))).toEqual(["E1", "Routing"]);
    expect(titles(await admin.get(`/api/catalog/exams?tagIds=${w.tagCore.id},${midterm.id}`))).toEqual(["Routing"]);
    expect(titles(await admin.get(`/api/catalog/exams?tagIds=${midterm.id}&q=STOR`))).toEqual(["Storage"]);
  });

  it("paginates with stable totals", async () => {
    for (let i = 0; i < 4; i++) await makeExam(db, w.cloud, { title: `Extra ${i}` });
    const first = (await admin.get("/api/catalog/exams?limit=5")).body as ExamList;
    const second = (await admin.get(`/api/catalog/exams?limit=5&cursor=${first.nextCursor ?? ""}`)).body as ExamList;
    expect(first.total).toBe(7);
    expect(second.total).toBe(7);
    expect([...first.items, ...second.items].map((e) => e.id)).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
  });
});

describe("catalog edge cases", () => {
  const MISSING = "99999999-9999-4999-8999-999999999999";

  it("filters exams by status", async () => {
    await makeExam(db, w.cloud, { title: "Draft one", status: "DRAFT" });
    expect(titles(await admin.get("/api/catalog/exams?status=DRAFT"))).toEqual(["Draft one"]);
  });

  it("refuses moving an exam into an unknown or archived category", async () => {
    expect((await admin.patch(`/api/catalog/exams/${w.e1.id}`).send({ categoryId: MISSING })).status).toBe(400);
    await admin.patch(`/api/catalog/categories/${w.unusedCategory.id}`).send({ archived: true });
    expect((await admin.patch(`/api/catalog/exams/${w.e1.id}`).send({ categoryId: w.unusedCategory.id })).status).toBe(
      400,
    );
  });

  it("refuses creating an exam with unknown tags", async () => {
    const res = await admin
      .post("/api/catalog/exams")
      .send({ code: "T-1", title: "T", categoryId: w.cloud.id, durationMinutes: 10, tagIds: [MISSING] });
    expect(res.status).toBe(400);
  });

  it("answers 404 for unknown categories and tags", async () => {
    expect((await admin.patch(`/api/catalog/categories/${MISSING}`).send({ position: 1 })).status).toBe(404);
    expect((await admin.delete(`/api/catalog/categories/${MISSING}`).send({})).status).toBe(404);
    expect((await admin.patch(`/api/catalog/tags/${MISSING}`).send({ name: "x" })).status).toBe(404);
    expect((await admin.delete(`/api/catalog/tags/${MISSING}`).send({})).status).toBe(404);
  });

  it("refuses renaming into an existing name", async () => {
    expect((await admin.patch(`/api/catalog/categories/${w.cloud.id}`).send({ name: "networking" })).status).toBe(409);
    await makeTag(db, { name: "midterm" });
    expect((await admin.patch(`/api/catalog/tags/${w.tagCore.id}`).send({ name: "MIDTERM" })).status).toBe(409);
  });
});

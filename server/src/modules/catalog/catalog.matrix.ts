import { statuses, superAdminOnly, type MatrixRow } from "../../test/matrix.js";

const staffOnly = (ok: number) => statuses(ok, { student: 403 });
/** Scoped routes: out-of-scope instructors get 404 (existence hidden), students 403. */
const scoped = (ok: Partial<Record<"instExamA" | "instCategory" | "instSplit" | "instTag", number>>) =>
  statuses(404, { superAdmin: 200, student: 403, ...ok });

export const catalogRows: MatrixRow[] = [
  // ── Categories ──
  {
    route: "GET /api/catalog/categories",
    request: () => ({ path: "/api/catalog/categories" }),
    expect: staffOnly(200),
  },
  {
    route: "POST /api/catalog/categories",
    request: () => ({ path: "/api/catalog/categories", body: { name: "Operating Systems" } }),
    expect: superAdminOnly(201),
  },
  {
    route: "PATCH /api/catalog/categories/:id",
    request: (w) => ({ path: `/api/catalog/categories/${w.cloud.id}`, body: { position: 2 } }),
    expect: superAdminOnly(200),
  },
  {
    route: "DELETE /api/catalog/categories/:id",
    request: (w) => ({ path: `/api/catalog/categories/${w.unusedCategory.id}` }),
    expect: superAdminOnly(204),
  },

  // ── Tags ──
  { route: "GET /api/catalog/tags", request: () => ({ path: "/api/catalog/tags" }), expect: staffOnly(200) },
  {
    route: "POST /api/catalog/tags",
    request: () => ({ path: "/api/catalog/tags", body: { name: "midterm" } }),
    expect: superAdminOnly(201),
  },
  {
    route: "PATCH /api/catalog/tags/:id",
    request: (w) => ({ path: `/api/catalog/tags/${w.tagCore.id}`, body: { name: "Core" } }),
    expect: superAdminOnly(200),
  },
  {
    route: "DELETE /api/catalog/tags/:id",
    label: "a plain tag",
    request: (w) => ({ path: `/api/catalog/tags/${w.tagSpare.id}` }),
    expect: superAdminOnly(204),
  },
  {
    route: "DELETE /api/catalog/tags/:id",
    label: "an access tag (used by instTag's grant): refused even for super admins",
    request: (w) => ({ path: `/api/catalog/tags/${w.tagCore.id}` }),
    expect: superAdminOnly(409),
  },

  // ── Exams ──
  { route: "GET /api/catalog/exams", request: () => ({ path: "/api/catalog/exams" }), expect: staffOnly(200) },
  {
    route: "POST /api/catalog/exams",
    label: "in Cloud",
    request: (w) => ({
      path: "/api/catalog/exams",
      body: { code: "CLOUD-2", title: "Cloud 2", categoryId: w.cloud.id, durationMinutes: 30 },
    }),
    expect: statuses(404, { superAdmin: 201, student: 403, instCategory: 201 }),
  },
  {
    route: "POST /api/catalog/exams",
    label: "in Networking",
    request: (w) => ({
      path: "/api/catalog/exams",
      body: { code: "NET-3", title: "Net 3", categoryId: w.networking.id, durationMinutes: 30 },
    }),
    // instExamA sees E1 (an exam), not the whole Networking category.
    expect: statuses(404, { superAdmin: 201, student: 403 }),
  },
  {
    route: "GET /api/catalog/exams/:id",
    label: "E1 (Networking)",
    request: (w) => ({ path: `/api/catalog/exams/${w.e1.id}` }),
    expect: scoped({ instExamA: 200, instSplit: 200, instTag: 200 }),
  },
  {
    route: "GET /api/catalog/exams/:id",
    label: "E3 (Cloud)",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}` }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "PATCH /api/catalog/exams/:id",
    label: "E3 (Cloud)",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}`, body: { title: "Cloud Gates" } }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "PATCH /api/catalog/exams/:id",
    label: "E1: visible to instExamA/instSplit but not editable",
    request: (w) => ({ path: `/api/catalog/exams/${w.e1.id}`, body: { title: "Network Fundamentals" } }),
    // instTag holds EXAM_EDIT on exams tagged "core".
    expect: scoped({ instExamA: 403, instSplit: 403, instTag: 200 }),
  },
  {
    route: "PUT /api/catalog/exams/:id/tags",
    label: "a plain tag on E3",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/tags`, body: { tagIds: [w.tagSpare.id] } }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "PUT /api/catalog/exams/:id/tags",
    label: "an access tag on E3: super admins only",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/tags`, body: { tagIds: [w.tagCore.id] } }),
    expect: scoped({ instCategory: 403 }),
  },
  {
    route: "PUT /api/catalog/exams/:id/tags",
    label: "removing the access tag from E1: super admins only",
    request: (w) => ({ path: `/api/catalog/exams/${w.e1.id}/tags`, body: { tagIds: [] } }),
    // instTag may edit E1 but not its access tag; instExamA/instSplit see E1 but can't edit it.
    expect: scoped({ instTag: 403, instExamA: 403, instSplit: 403 }),
  },

  // ── Exam content (EXAM_EDIT on the exam). E3 is in Cloud: only instCategory (Cloud × all groups) edits it.
  //    E1 is visible to instExamA/instSplit (other permissions): 403, not 404.
  {
    route: "GET /api/catalog/exams/:id/questions",
    label: "E3 (Cloud)",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/questions` }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "GET /api/catalog/exams/:id/questions",
    label: "E1, visible without EXAM_EDIT",
    request: (w) => ({ path: `/api/catalog/exams/${w.e1.id}/questions` }),
    expect: scoped({ instExamA: 403, instSplit: 403, instTag: 200 }),
  },
  {
    route: "POST /api/catalog/exams/:id/questions",
    request: (w) => ({
      path: `/api/catalog/exams/${w.e3.id}/questions`,
      body: {
        type: "TRUE_FALSE",
        text: "Sky is blue",
        options: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
        ],
      },
    }),
    expect: statuses(404, { superAdmin: 201, student: 403, instCategory: 201 }),
  },
  {
    route: "PUT /api/catalog/exams/:id/questions/order",
    request: (w) => ({
      path: `/api/catalog/exams/${w.e3.id}/questions/order`,
      body: { questionIds: [w.questionE3.id] },
    }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "POST /api/catalog/exams/:id/questions/import",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/questions/import`, body: { questions: [{}] } }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "PATCH /api/catalog/questions/:id",
    request: (w) => ({ path: `/api/catalog/questions/${w.questionE3.id}`, body: { text: "Two plus two?" } }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "DELETE /api/catalog/questions/:id",
    request: (w) => ({ path: `/api/catalog/questions/${w.questionE3.id}` }),
    expect: statuses(404, { superAdmin: 204, student: 403, instCategory: 204 }),
  },
  {
    route: "GET /api/catalog/exams/:id/materials",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/materials` }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "POST /api/catalog/exams/:id/materials",
    request: (w) => ({
      path: `/api/catalog/exams/${w.e3.id}/materials`,
      body: { title: "Notes", url: "https://example.com/n" },
    }),
    expect: statuses(404, { superAdmin: 201, student: 403, instCategory: 201 }),
  },
  {
    route: "PATCH /api/catalog/materials/:id",
    request: (w) => ({ path: `/api/catalog/materials/${w.materialE3.id}`, body: { title: "Slides v2" } }),
    expect: scoped({ instCategory: 200 }),
  },
  {
    route: "DELETE /api/catalog/materials/:id",
    request: (w) => ({ path: `/api/catalog/materials/${w.materialE3.id}` }),
    expect: statuses(404, { superAdmin: 204, student: 403, instCategory: 204 }),
  },
  {
    route: "POST /api/catalog/exams/:id/duplicate",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/duplicate`, body: { code: "E3-COPY" } }),
    expect: statuses(404, { superAdmin: 201, student: 403, instCategory: 201 }),
  },
];

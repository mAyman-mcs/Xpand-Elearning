import { statuses, superAdminOnly, type MatrixRow } from "../../test/matrix.js";

const staffOnly = (ok: number) => statuses(ok, { student: 403 });
/** Scoped routes: out-of-scope instructors get 404 (existence hidden), students 403. */
const scoped = (ok: Partial<Record<"instExamA" | "instCategory" | "instSplit", number>>) =>
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
    request: (w) => ({ path: `/api/catalog/tags/${w.tagCore.id}` }),
    expect: superAdminOnly(204),
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
    expect: scoped({ instExamA: 200, instSplit: 200 }),
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
    expect: scoped({ instExamA: 403, instSplit: 403 }),
  },
  {
    route: "PUT /api/catalog/exams/:id/tags",
    request: (w) => ({ path: `/api/catalog/exams/${w.e3.id}/tags`, body: { tagIds: [w.tagCore.id] } }),
    expect: scoped({ instCategory: 200 }),
  },
];

// The RBAC endpoint matrix (docs/BACKEND_PLAN.md §3.4): every non-public API route × every actor,
// each cell against a freshly seeded world. Add rows in the module's *.matrix.ts file.
import { afterAll, describe, expect, it } from "vitest";
import { apiRouteTable } from "./app.js";
import { adminRows } from "./modules/admin/admin.matrix.js";
import { assignmentsRows } from "./modules/assignments/assignments.matrix.js";
import { catalogRows } from "./modules/catalog/catalog.matrix.js";
import { authAndRbacRows, groupsRows, usersRows } from "./modules/rbac/rbac.matrix.js";
import { createTestApp, resetDb } from "./test/app.js";
import { runCell, type MatrixRow } from "./test/matrix.js";
import { ACTORS, seedWorld } from "./test/rbac-world.js";

const ROWS: MatrixRow[] = [
  ...authAndRbacRows,
  ...usersRows,
  ...groupsRows,
  ...catalogRows,
  ...assignmentsRows,
  ...adminRows,
];

const { app, db, deps } = createTestApp();
afterAll(() => db.$disconnect());

describe("RBAC matrix completeness", () => {
  const table = apiRouteTable(deps);

  it("has at least one row for every non-public route", () => {
    const covered = new Set(ROWS.map((r) => r.route));
    const missing = table.filter((r) => r.access.kind !== "public" && !covered.has(r.key)).map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it("has no rows for routes that do not exist", () => {
    const known = new Set(table.map((r) => r.key));
    expect(ROWS.map((r) => r.route).filter((route) => !known.has(route))).toEqual([]);
  });
});

describe.each(ROWS.map((row) => [`${row.route}${row.label ? ` (${row.label})` : ""}`, row] as const))(
  "%s",
  (_name, row) => {
    it.each(ACTORS)("%s", async (actor) => {
      await resetDb(db);
      const world = await seedWorld(db);
      const res = await runCell(app, world, row, actor);
      expect(res.status, JSON.stringify(res.body)).toBe(row.expect[actor]);
    });
  },
);

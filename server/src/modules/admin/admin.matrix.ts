import { superAdminOnly, type MatrixRow } from "../../test/matrix.js";

// Super admin only (instructors with AUDIT_VIEW get a scoped audit view in B9).
export const adminRows: MatrixRow[] = [
  { route: "GET /api/admin/stats", request: () => ({ path: "/api/admin/stats" }), expect: superAdminOnly(200) },
  { route: "GET /api/audit", request: () => ({ path: "/api/audit" }), expect: superAdminOnly(200) },
  { route: "GET /api/audit/actions", request: () => ({ path: "/api/audit/actions" }), expect: superAdminOnly(200) },
];

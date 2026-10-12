// The fixed starting data of the browser integration tests (docs/ADMIN_DASHBOARD_PLAN.md §5.2).
// Imported by seed-e2e.ts (to create it) and by the Playwright specs (to log in and find things).
// Test-only credentials for a throwaway database: never used anywhere else.

export const E2E_PASSWORD = "E2e-pass-2026";

export const WORLD = {
  users: {
    admin: { username: "e2e.admin", fullName: "E2E Admin", role: "SUPER_ADMIN" },
    instNone: { username: "e2e.inst.none", fullName: "Ingrid No-Grants", role: "INSTRUCTOR" },
    instCloud: { username: "e2e.inst.cloud", fullName: "Ivan Cloud", role: "INSTRUCTOR" },
    studentA1: { username: "e2e.stu.a1", fullName: "Amal Group-A", role: "STUDENT" },
    studentA2: { username: "e2e.stu.a2", fullName: "Adam Group-A", role: "STUDENT" },
    studentB1: { username: "e2e.stu.b1", fullName: "Bassem Group-B", role: "STUDENT" },
    studentNone: { username: "e2e.stu.none", fullName: "Nour No-Group", role: "STUDENT" },
  },
  groups: {
    a: { name: "E2E Group A", intakeStartDate: "2026-07-01", members: ["studentA1", "studentA2"] },
    b: { name: "E2E Group B", intakeStartDate: "2026-08-01", members: ["studentB1"] },
  },
  categories: {
    cloud: { name: "E2E Cloud" },
    networking: { name: "E2E Networking" },
  },
  exams: {
    cloudGates: { code: "E2E-CLOUD", title: "E2E Cloud Gates", category: "cloud" },
    netBasics: { code: "E2E-NET", title: "E2E Network Basics", category: "networking" },
  },
  /** instCloud: one grant, category Cloud × group A. */
  grants: {
    instCloud: {
      permissions: ["EXAM_EDIT", "EXAM_ASSIGN", "EXAM_SCHEDULE", "RESULTS_VIEW"],
      categories: ["cloud"],
      groups: ["a"],
    },
  },
} as const;

export type WorldUser = keyof typeof WORLD.users;

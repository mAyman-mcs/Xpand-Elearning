import type { Db } from "../core/db.js";
import { ALL_PERMISSIONS } from "../modules/rbac/authorize.js";
import { makeCategory, makeExam, makeGrant, makeGroup, makeTag, makeUser, type TestUser } from "./factories.js";

/** The actors every RBAC matrix row must cover (docs/BACKEND_PLAN.md §3.4). */
export const ACTORS = [
  "superAdmin",
  "student",
  "instNone",
  "instExamA",
  "instCategory",
  "instSplit",
  "instExpired",
  "anonymous",
] as const;
export type Actor = (typeof ACTORS)[number];

export type World = Awaited<ReturnType<typeof seedWorld>>;

/**
 * Groups A and B; categories Networking (E1, E2), Cloud (E3) and Unused; tag "core" on E1;
 * a student in each group.
 * - instExamA:    RESULTS_VIEW + EXAM_ASSIGN on E1 × group A
 * - instCategory: EXAM_EDIT + EXAM_ASSIGN + EXAM_SCHEDULE on category Cloud × all groups
 * - instSplit:    RESULTS_VIEW on E1 × A, and RESULTS_VIEW on E2 × B (the combination trap)
 * - instExpired:  every permission on everything, expired
 */
export async function seedWorld(db: Db, now = new Date()) {
  const groupA = await makeGroup(db, { name: "Group A" });
  const groupB = await makeGroup(db, { name: "Group B" });
  const networking = await makeCategory(db, { name: "Networking" });
  const cloud = await makeCategory(db, { name: "Cloud" });
  const unusedCategory = await makeCategory(db, { name: "Unused" });
  const tagCore = await makeTag(db, { name: "core" });
  const e1 = await makeExam(db, networking, { title: "E1", tags: [tagCore] });
  const e2 = await makeExam(db, networking, { title: "E2" });
  const e3 = await makeExam(db, cloud, { title: "E3" });

  const users: Record<Exclude<Actor, "anonymous">, TestUser> = {
    superAdmin: await makeUser(db, { role: "SUPER_ADMIN", username: "super" }),
    student: await makeUser(db, { username: "student.a", groups: [groupA] }),
    instNone: await makeUser(db, { role: "INSTRUCTOR", username: "inst.none" }),
    instExamA: await makeUser(db, { role: "INSTRUCTOR", username: "inst.exam-a" }),
    instCategory: await makeUser(db, { role: "INSTRUCTOR", username: "inst.category" }),
    instSplit: await makeUser(db, { role: "INSTRUCTOR", username: "inst.split" }),
    instExpired: await makeUser(db, { role: "INSTRUCTOR", username: "inst.expired" }),
  };
  const studentB = await makeUser(db, { username: "student.b", groups: [groupB] });

  const examAGrant = await makeGrant(db, users.instExamA, {
    permissions: ["RESULTS_VIEW", "EXAM_ASSIGN"],
    examIds: [e1.id],
    groupIds: [groupA.id],
  });
  await makeGrant(db, users.instCategory, {
    permissions: ["EXAM_EDIT", "EXAM_ASSIGN", "EXAM_SCHEDULE"],
    categoryIds: [cloud.id],
    allGroups: true,
  });
  await makeGrant(db, users.instSplit, { permissions: ["RESULTS_VIEW"], examIds: [e1.id], groupIds: [groupA.id] });
  await makeGrant(db, users.instSplit, { permissions: ["RESULTS_VIEW"], examIds: [e2.id], groupIds: [groupB.id] });
  await makeGrant(db, users.instExpired, {
    permissions: [...ALL_PERMISSIONS],
    allExams: true,
    allGroups: true,
    expiresAt: new Date(now.getTime() - 60_000),
  });

  // E1 → group A (fixed window, open now) and E3 → group B; an OPEN override on E1 for group A.
  const assignmentE1A = await db.assignment.create({
    data: { examId: e1.id, groupId: groupA.id, mode: "FIXED", opensAt: new Date(now.getTime() - 3_600_000) },
  });
  const assignmentE3B = await db.assignment.create({ data: { examId: e3.id, groupId: groupB.id, mode: "MANUAL" } });
  const overrideE1A = await db.accessOverride.create({
    data: {
      examId: e1.id,
      groupId: groupA.id,
      action: "OPEN",
      reason: "seed",
      validFrom: new Date(now.getTime() - 60_000),
    },
  });

  // Content of E3 (Cloud), for the exam-content routes.
  const questionE3 = await db.question.create({
    data: {
      examId: e3.id,
      type: "SINGLE_CHOICE",
      text: "2 + 2?",
      position: 0,
      options: {
        create: [
          { text: "4", isCorrect: true, position: 0 },
          { text: "5", isCorrect: false, position: 1 },
        ],
      },
    },
  });
  const materialE3 = await db.material.create({
    data: { examId: e3.id, title: "Slides", url: "https://example.com/s" },
  });

  return {
    users,
    questionE3,
    materialE3,
    studentB,
    groupA,
    groupB,
    networking,
    cloud,
    unusedCategory,
    tagCore,
    e1,
    e2,
    e3,
    examAGrant,
    assignmentE1A,
    assignmentE3B,
    overrideE1A,
  };
}

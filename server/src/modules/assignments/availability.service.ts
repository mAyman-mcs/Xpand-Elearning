import { actorOf, type Ctx } from "../../core/context.js";
import { notFound } from "../../core/errors.js";
import { reachForExam, reachOf, studentWhere } from "../rbac/scope.js";
import { resolveAvailability } from "./availability.js";
import { loadExamRules, loadStudents, rulesFor } from "./inputs.js";

/** The student's own exam list: assigned, published or archived exams, with status and progress. */
export async function studentExams(ctx: Ctx) {
  const userId = actorOf(ctx).userId;
  const student = (await loadStudents(ctx.db, [userId])).get(userId);
  if (!student) throw notFound("Student not found.");
  const groupIds = student.memberships.map((m) => m.groupId);

  const exams = await ctx.db.exam.findMany({
    where: {
      status: { not: "DRAFT" },
      assignments: { some: { OR: [{ userId }, { groupId: { in: groupIds } }] } },
    },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      tags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      materials: { select: { title: true, url: true }, orderBy: { position: "asc" } },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const rules = await loadExamRules(
    ctx.db,
    exams.map((e) => e.id),
    [student],
  );

  return exams.map((exam) => {
    const availability = resolveAvailability({ exam, student, now: ctx.now, ...rulesFor(rules, exam.id, userId) });
    return {
      exam: {
        id: exam.id,
        code: exam.code,
        title: exam.title,
        category: exam.category,
        tags: exam.tags.map((t) => t.tag),
        durationMinutes: exam.durationMinutes,
        isExternal: exam.isExternal,
        materials: exam.materials,
      },
      // Students see status, progress, window and a readable reason — not internal sources.
      status: availability.status,
      progress: availability.progress,
      opensAt: availability.opensAt,
      closesAt: availability.closesAt,
      reason: availability.reason,
    };
  });
}

/**
 * Staff view of one exam: every reachable student it is assigned to, with the resolved status,
 * progress and the reason/source ("why is this open?").
 */
export async function examAvailability(ctx: Ctx, examId: string) {
  const exam = await ctx.db.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      categoryId: true,
      status: true,
      isExternal: true,
      maxAttempts: true,
      tags: { select: { tagId: true } },
    },
  });
  if (!exam) throw notFound("Exam not found.");
  const reach = reachForExam(reachOf(actorOf(ctx), "any", ctx.now), { ...exam, tagIds: exam.tags.map((t) => t.tagId) });

  const assigned = await ctx.db.user.findMany({
    where: {
      AND: [
        studentWhere(reach),
        {
          OR: [
            { assignments: { some: { examId } } },
            { memberships: { some: { group: { assignments: { some: { examId } } } } } },
          ],
        },
      ],
    },
    select: { id: true, username: true, fullName: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
  const students = await loadStudents(
    ctx.db,
    assigned.map((u) => u.id),
  );
  const rules = await loadExamRules(ctx.db, [examId], [...students.values()]);

  return assigned.flatMap((user) => {
    const student = students.get(user.id);
    if (!student) return [];
    return [
      { student: user, ...resolveAvailability({ exam, student, now: ctx.now, ...rulesFor(rules, examId, user.id) }) },
    ];
  });
}

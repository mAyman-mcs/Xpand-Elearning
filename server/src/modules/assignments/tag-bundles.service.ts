import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { uuid } from "../../core/schemas.js";
import type { Prisma, TagAssignment } from "../../generated/prisma/client.js";
import { authorize, type Principal, type Scope } from "../rbac/authorize.js";
import { scheduleColumns, scheduleSchema } from "./schemas.js";

// A tag given to a group ("SOC Part 1" → "Cohort 5") is a live bundle: the group is assigned every
// exam carrying the tag, now and later. Each covered exam gets an ordinary Assignment row
// (tagAssignmentId set), so schedules, overrides and the student's exam list work unchanged.
// syncTagBundles() keeps those rows in step whenever tags, exams or bundles change.

export const createTagBundleBody = z.object({ tagId: uuid, groupId: uuid, schedule: scheduleSchema });
export const tagBundleQuery = z.object({ groupId: uuid.optional(), tagId: uuid.optional() });

/** What giving a tag to a group touches: every exam with the tag (now and later), and the group. */
export function bundleScope(tagId: string, groupId: string): Scope {
  return { tagIds: [tagId], groupIds: [groupId] };
}

export async function tagBundleScope(db: DbClient, id: string): Promise<Scope> {
  const bundle = await db.tagAssignment.findUnique({ where: { id }, select: { tagId: true, groupId: true } });
  if (!bundle) throw notFound("Tag assignment not found.");
  return bundleScope(bundle.tagId, bundle.groupId);
}

export async function assertTagAndGroupExist(db: DbClient, tagId: string, groupId: string) {
  const [tag, group] = await Promise.all([
    db.tag.findUnique({ where: { id: tagId }, select: { id: true } }),
    db.group.findUnique({ where: { id: groupId }, select: { id: true } }),
  ]);
  if (!tag) throw notFound("Tag not found.");
  if (!group) throw notFound("Group not found.");
}

const bundleInclude = {
  tag: { select: { id: true, name: true, _count: { select: { exams: true } } } },
  group: { select: { id: true, name: true } },
} satisfies Prisma.TagAssignmentInclude;
type BundleRow = Prisma.TagAssignmentGetPayload<{ include: typeof bundleInclude }>;

export function tagBundleDto(b: BundleRow) {
  return {
    id: b.id,
    tag: { id: b.tag.id, name: b.tag.name },
    group: { id: b.group.id, name: b.group.name },
    /** Exams carrying the tag right now. */
    examCount: b.tag._count.exams,
    schedule: {
      mode: b.mode,
      opensAt: b.opensAt,
      closesAt: b.closesAt,
      offsetDays: b.offsetDays,
      openTime: b.openTime,
      windowMinutes: b.windowMinutes,
    },
    createdAt: b.createdAt,
    createdById: b.createdById,
  };
}

const scheduleOf = (b: TagAssignment) => ({
  mode: b.mode,
  opensAt: b.opensAt,
  closesAt: b.closesAt,
  offsetDays: b.offsetDays,
  openTime: b.openTime,
  windowMinutes: b.windowMinutes,
});
const sameSchedule = (a: ReturnType<typeof scheduleOf>, b: ReturnType<typeof scheduleOf>) =>
  a.mode === b.mode &&
  a.opensAt?.getTime() === b.opensAt?.getTime() &&
  a.closesAt?.getTime() === b.closesAt?.getTime() &&
  a.offsetDays === b.offsetDays &&
  a.openTime === b.openTime &&
  a.windowMinutes === b.windowMinutes;

/**
 * Brings the tag-made assignments of these exams in line with their tags and the bundles:
 * - a group with a bundle for one of the exam's tags gets one row (the oldest bundle's schedule);
 * - a direct assignment of the exam to that group wins, so no row is made;
 * - rows whose tag is gone (tag taken off, bundle removed) are deleted.
 * Run inside the transaction that changed tags or bundles.
 */
export async function syncTagBundles(db: DbClient, examIds: string[]) {
  const ids = [...new Set(examIds)];
  if (!ids.length) return;
  const [exams, existing] = await Promise.all([
    db.exam.findMany({
      where: { id: { in: ids } },
      select: { id: true, tags: { select: { tag: { select: { bundles: true } } } } },
    }),
    db.assignment.findMany({
      where: { examId: { in: ids }, groupId: { not: null } },
      select: { id: true, examId: true, groupId: true, tagAssignmentId: true, ...scheduleSelect },
    }),
  ]);

  const creates: Prisma.AssignmentCreateManyInput[] = [];
  for (const exam of exams) {
    const bundles = exam.tags
      .flatMap((t) => t.tag.bundles)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const wanted = new Map<string, TagAssignment>();
    for (const b of bundles) if (!wanted.has(b.groupId)) wanted.set(b.groupId, b);

    for (const row of existing.filter((r) => r.examId === exam.id)) {
      const groupId = row.groupId ?? "";
      const want = wanted.get(groupId);
      wanted.delete(groupId);
      if (row.tagAssignmentId === null) continue; // made directly: it stays and wins
      if (!want) await db.assignment.delete({ where: { id: row.id } });
      else if (row.tagAssignmentId !== want.id || !sameSchedule(row, scheduleOf(want)))
        await db.assignment.update({
          where: { id: row.id },
          data: { tagAssignmentId: want.id, ...scheduleOf(want) },
        });
    }
    for (const b of wanted.values())
      creates.push({
        examId: exam.id,
        groupId: b.groupId,
        tagAssignmentId: b.id,
        ...scheduleOf(b),
        createdById: b.createdById,
      });
  }
  if (creates.length) await db.assignment.createMany({ data: creates });
}

const scheduleSelect = {
  mode: true,
  opensAt: true,
  closesAt: true,
  offsetDays: true,
  openTime: true,
  windowMinutes: true,
} as const;

/**
 * Putting a tag on an exam (or taking it off) assigns (or unassigns) the exam for every group the
 * tag is given to. That needs EXAM_ASSIGN on the exam for each of those groups.
 */
export async function assertMayChangeBundleTags(
  db: DbClient,
  actor: Principal,
  exam: { examId?: string; categoryId: string; tagIds: string[] },
  changedTagIds: string[],
  now: Date,
) {
  if (actor.role === "SUPER_ADMIN" || !changedTagIds.length) return;
  const bundles = await db.tagAssignment.findMany({
    where: { tagId: { in: changedTagIds } },
    select: { tag: { select: { name: true } }, group: { select: { id: true, name: true } } },
  });
  const refused = bundles.filter((b) => !authorize(actor, "EXAM_ASSIGN", { ...exam, groupIds: [b.group.id] }, now));
  if (refused.length) {
    const names = [...new Set(refused.map((b) => `“${b.tag.name}”`))].join(", ");
    throw new AppError("FORBIDDEN", {
      message: `${names} ${refused.length === 1 ? "is" : "are"} given to groups you can't assign exams to (${[...new Set(refused.map((b) => b.group.name))].join(", ")}), so you can't add or remove ${refused.length === 1 ? "it" : "them"} here.`,
    });
  }
}

// ───────────────────────────── Endpoints ─────────────────────────────

/** Bundles the caller may manage (EXAM_ASSIGN on the tag and the group). */
export async function listTagBundles(ctx: Ctx, filter: z.infer<typeof tagBundleQuery>) {
  const actor = actorOf(ctx);
  const rows = await ctx.db.tagAssignment.findMany({
    where: { tagId: filter.tagId, groupId: filter.groupId },
    include: bundleInclude,
    orderBy: [{ tag: { name: "asc" } }, { group: { name: "asc" } }, { id: "asc" }],
  });
  return rows
    .filter((b) => authorize(actor, "EXAM_ASSIGN", bundleScope(b.tagId, b.groupId), ctx.now))
    .map(tagBundleDto);
}

export async function createTagBundle(ctx: Ctx, input: z.infer<typeof createTagBundleBody>) {
  const actor = actorOf(ctx);
  const columns = scheduleColumns(input.schedule);
  try {
    return await inTransaction(ctx.db, async (tx) => {
      await assertTagAndGroupExist(tx, input.tagId, input.groupId);
      const bundle = await tx.tagAssignment.create({
        data: { tagId: input.tagId, groupId: input.groupId, ...columns, createdById: actor.userId },
        include: bundleInclude,
      });
      const exams = await tx.examTag.findMany({ where: { tagId: input.tagId }, select: { examId: true } });
      await syncTagBundles(
        tx,
        exams.map((e) => e.examId),
      );
      const assigned = await tx.assignment.count({ where: { tagAssignmentId: bundle.id } });
      await audit(tx, {
        action: "assignments.tag_bundle_created",
        actorId: actor.userId,
        entityType: "TagAssignment",
        entityId: bundle.id,
        detail: {
          tagId: input.tagId,
          groupId: input.groupId,
          assigned,
          schedule: {
            ...columns,
            opensAt: columns.opensAt?.toISOString() ?? null,
            closesAt: columns.closesAt?.toISOString() ?? null,
          },
        },
        ip: ctx.ip,
      });
      return { ...tagBundleDto(bundle), assigned };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("This tag is already given to that group.");
    throw err;
  }
}

/** Removes the bundle: the group loses every exam it got through the tag (not direct assignments). */
export async function deleteTagBundle(ctx: Ctx, id: string): Promise<void> {
  const actor = actorOf(ctx);
  await inTransaction(ctx.db, async (tx) => {
    const bundle = await tx.tagAssignment.findUnique({ where: { id } });
    if (!bundle) throw notFound("Tag assignment not found.");
    const rows = await tx.assignment.findMany({ where: { tagAssignmentId: id }, select: { examId: true } });
    // Deleting the bundle deletes its rows (cascade); another tag given to the same group may still cover them.
    await tx.tagAssignment.delete({ where: { id } });
    await syncTagBundles(
      tx,
      rows.map((r) => r.examId),
    );
    await audit(tx, {
      action: "assignments.tag_bundle_deleted",
      actorId: actor.userId,
      entityType: "TagAssignment",
      entityId: id,
      detail: { tagId: bundle.tagId, groupId: bundle.groupId, unassigned: rows.length },
      ip: ctx.ip,
    });
  });
}

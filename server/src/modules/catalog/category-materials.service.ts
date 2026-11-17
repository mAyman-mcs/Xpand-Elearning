import type { z } from "zod";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction } from "../../core/db.js";
import { notFound } from "../../core/errors.js";
import { loadStudents } from "../assignments/inputs.js";
import { authorize, canSeeAnything } from "../rbac/authorize.js";
import { examWhere, reachOf } from "../rbac/scope.js";
import { auditMaterial, materialDto, type materialBody } from "./content.service.js";

// Training links for every exam of a category (docs/FIXES_PLAN.md fix 2). Staff read and edit them
// on the Materials page; students see the categories of the published exams assigned to them.

const byPosition = [{ position: "asc" as const }, { title: "asc" as const }];

/**
 * GET /api/catalog/materials: one section per category the caller can reach, with its links.
 * Instructors reach a category through a grant on it, or through any exam of it they can see.
 */
export async function staffMaterials(ctx: Ctx) {
  const actor = actorOf(ctx);
  const [categories, reachable] = await Promise.all([
    ctx.db.category.findMany({
      where: { archived: false },
      include: { materials: { orderBy: byPosition } },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
    actor.role === "SUPER_ADMIN"
      ? null
      : ctx.db.exam.findMany({
          where: examWhere(reachOf(actor, "any", ctx.now)),
          select: { categoryId: true },
          distinct: ["categoryId"],
        }),
  ]);
  const viaExam = new Set(reachable?.map((e) => e.categoryId));
  return categories
    .filter((c) => !reachable || viaExam.has(c.id) || canSeeAnything(actor, { categoryId: c.id }, ctx.now))
    .map((c) => ({
      category: { id: c.id, name: c.name },
      /** EXAM_EDIT on the category: may add, edit and remove its links. */
      canEdit: authorize(actor, "EXAM_EDIT", { categoryId: c.id }, ctx.now),
      materials: c.materials.map(materialDto),
    }));
}

export async function createCategoryMaterial(ctx: Ctx, categoryId: string, input: z.infer<typeof materialBody>) {
  return inTransaction(ctx.db, async (tx) => {
    const last = await tx.material.aggregate({ where: { categoryId }, _max: { position: true } });
    const m = await tx.material.create({ data: { categoryId, ...input, position: (last._max.position ?? -1) + 1 } });
    await auditMaterial(ctx, tx, "catalog.material_created", m, { materialId: m.id, title: m.title });
    return materialDto(m);
  });
}

/**
 * GET /api/student/materials: per category of the student's published, assigned exams, the
 * category's links and each exam's own links. Categories with no links at all are left out.
 */
export async function studentMaterials(ctx: Ctx) {
  const userId = actorOf(ctx).userId;
  const student = (await loadStudents(ctx.db, [userId])).get(userId);
  /* v8 ignore next -- the route only lets students in */
  if (!student) throw notFound("Student not found.");
  const groupIds = student.memberships.map((m) => m.groupId);

  const exams = await ctx.db.exam.findMany({
    where: {
      status: { not: "DRAFT" },
      assignments: { some: { OR: [{ userId }, { groupId: { in: groupIds } }] } },
    },
    select: {
      id: true,
      code: true,
      title: true,
      category: { select: { id: true, name: true, position: true, materials: { orderBy: byPosition } } },
      materials: { orderBy: byPosition },
    },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });

  const sections = new Map<
    string,
    {
      position: number;
      category: { id: string; name: string };
      materials: { title: string; url: string }[];
      exams: { id: string; code: string; title: string; materials: { title: string; url: string }[] }[];
    }
  >();
  const link = (m: { title: string; url: string }) => ({ title: m.title, url: m.url });
  for (const e of exams) {
    const c = e.category;
    const section = sections.get(c.id) ?? {
      position: c.position,
      category: { id: c.id, name: c.name },
      materials: c.materials.map(link),
      exams: [],
    };
    if (e.materials.length)
      section.exams.push({ id: e.id, code: e.code, title: e.title, materials: e.materials.map(link) });
    sections.set(c.id, section);
  }
  return [...sections.values()]
    .filter((s) => s.materials.length || s.exams.length)
    .sort((a, b) => a.position - b.position || a.category.name.localeCompare(b.category.name))
    .map(({ category, materials, exams: withLinks }) => ({ category, materials, exams: withLinks }));
}

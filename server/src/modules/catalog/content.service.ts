import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { nonBlank, uuid } from "../../core/schemas.js";
import { QuestionType, type Prisma } from "../../generated/prisma/client.js";
import { authorize } from "../rbac/authorize.js";

// Exam content: questions, options, materials, duplication and the publish check
// (docs/NEXT_PLAN.md §2, B5). Staff-only: these DTOs include the answer key (isCorrect) and must
// never be served to students.

// ─────────────────────────────── Pure rules ───────────────────────────────

export interface QuestionShape {
  type: QuestionType;
  text: string;
  points: number;
  options: { text: string; isCorrect: boolean }[];
}

/** What makes one question unusable, in words (empty = valid). */
export function questionProblems(q: QuestionShape): string[] {
  const problems: string[] = [];
  const correct = q.options.filter((o) => o.isCorrect).length;
  if (!q.text.trim()) problems.push("The question has no text.");
  if (!(q.points > 0)) problems.push("Points must be more than 0.");
  if (q.options.some((o) => !o.text.trim())) problems.push("An option has no text.");
  if (q.type === "TRUE_FALSE") {
    if (q.options.length !== 2) problems.push("True/false questions have exactly 2 options.");
    if (correct !== 1) problems.push("Mark exactly one option as correct.");
  } else {
    if (q.options.length < 2 || q.options.length > 10) problems.push("Give between 2 and 10 options.");
    if (q.type === "SINGLE_CHOICE" && correct !== 1) problems.push("Mark exactly one option as correct.");
    if (q.type === "MULTI_CHOICE" && correct < 1) problems.push("Mark at least one option as correct.");
  }
  return problems;
}

/** Why an exam can't be published yet (empty = it can). External exams have no questions. */
export function publishProblems(
  exam: { isExternal: boolean; questionsPerAttempt: number | null },
  questions: QuestionShape[],
): string[] {
  if (exam.isExternal) return [];
  const problems: string[] = [];
  if (questions.length === 0) problems.push("Add at least one question.");
  questions.forEach((q, i) => {
    for (const p of questionProblems(q)) problems.push(`Question ${i + 1}: ${p}`);
  });
  // Random draws come with question pools (NEXT_PLAN E3, B12); until then the setting would be ignored.
  if (exam.questionsPerAttempt !== null)
    problems.push("“Questions per attempt” must be empty until question pools arrive.");
  return problems;
}

// ─────────────────────────────── Schemas ───────────────────────────────

const httpsUrl = z.url({ protocol: /^https$/, error: "Use a full https:// link" }).max(2000);
const optionInput = z.object({ text: nonBlank(1000), isCorrect: z.boolean() });
const questionFields = {
  type: z.enum(QuestionType),
  text: nonBlank(5000),
  imageUrl: httpsUrl.nullable(),
  points: z.number().positive().max(100),
};

export const questionBody = z.object({
  ...questionFields,
  imageUrl: questionFields.imageUrl.default(null),
  points: questionFields.points.default(1),
  options: z.array(optionInput).max(10),
});
export type QuestionInput = z.infer<typeof questionBody>;

/** Options are replaced as a whole; ids identify existing options (needed once the exam is locked). */
export const questionPatchBody = z
  .object({ ...questionFields, options: z.array(optionInput.extend({ id: uuid.optional() })).max(10) })
  .partial();

export const reorderBody = z.object({ questionIds: z.array(uuid).max(500) });
export const importQuestionsBody = z.object({
  questions: z.array(z.unknown()).min(1, "No questions to import").max(200),
  dryRun: z.boolean().default(true),
});
export const materialBody = z.object({ title: nonBlank(200), url: httpsUrl });
export const materialPatchBody = materialBody.partial();
export const duplicateBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,30}$/, "2-31 characters: A-Z 0-9 and dashes"),
  title: nonBlank(200).optional(),
});

// ─────────────────────────────── DTOs ───────────────────────────────

const withOptions = { options: { orderBy: { position: "asc" } } } satisfies Prisma.QuestionInclude;
type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof withOptions }>;

export function questionDto(q: QuestionRow) {
  return {
    id: q.id,
    type: q.type,
    text: q.text,
    imageUrl: q.imageUrl,
    points: q.points.toNumber(),
    position: q.position,
    options: q.options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.isCorrect, position: o.position })),
  };
}
type QuestionDto = ReturnType<typeof questionDto>;

const materialDto = (m: { id: string; title: string; url: string; position: number }) => ({
  id: m.id,
  title: m.title,
  url: m.url,
  position: m.position,
});

// ─────────────────────────────── Helpers ───────────────────────────────

const invalid = (problems: string[], path = "options") =>
  new AppError("VALIDATION_FAILED", {
    message: problems.join(" "),
    details: problems.map((message) => ({ path, message })),
  });

const lockedError = () =>
  conflict(
    "Students have already taken this exam: only the wording of questions and options can change. Duplicate the exam to change more.",
  );

/** An exam with attempts is locked: grades must stay explainable (NEXT_PLAN E1). */
async function isLocked(db: DbClient, examId: string): Promise<boolean> {
  return (await db.attempt.count({ where: { examId } })) > 0;
}

async function loadQuestions(db: DbClient, examId: string): Promise<QuestionDto[]> {
  const rows = await db.question.findMany({ where: { examId }, include: withOptions, orderBy: { position: "asc" } });
  return rows.map(questionDto);
}

/** Positions 0..n-1 in the given order (after deletes and reorders). */
async function renumber(tx: Prisma.TransactionClient, ids: string[]) {
  for (const [position, id] of ids.entries()) await tx.question.update({ where: { id }, data: { position } });
}

async function auditContent(
  ctx: Ctx,
  tx: Prisma.TransactionClient,
  action: string,
  examId: string,
  detail: Prisma.InputJsonObject,
) {
  await audit(tx, { action, actorId: actorOf(ctx).userId, entityType: "Exam", entityId: examId, detail, ip: ctx.ip });
}

// ─────────────────────────────── Questions ───────────────────────────────

/** The exam's questions with the answer key, whether it is locked, and what blocks publishing. */
export async function listQuestions(ctx: Ctx, examId: string) {
  const exam = await ctx.db.exam.findUnique({
    where: { id: examId },
    select: { isExternal: true, questionsPerAttempt: true },
  });
  if (!exam) throw notFound("Exam not found.");
  const questions = await loadQuestions(ctx.db, examId);
  return { locked: await isLocked(ctx.db, examId), questions, publishProblems: publishProblems(exam, questions) };
}

export async function createQuestion(ctx: Ctx, examId: string, input: QuestionInput): Promise<QuestionDto> {
  const problems = questionProblems(input);
  if (problems.length) throw invalid(problems);
  return inTransaction(ctx.db, async (tx) => {
    if (await isLocked(tx, examId)) throw lockedError();
    const last = await tx.question.aggregate({ where: { examId }, _max: { position: true } });
    const q = await tx.question.create({
      data: {
        examId,
        type: input.type,
        text: input.text,
        imageUrl: input.imageUrl,
        points: input.points,
        position: (last._max.position ?? -1) + 1,
        options: { create: input.options.map((o, position) => ({ ...o, position })) },
      },
      include: withOptions,
    });
    await auditContent(ctx, tx, "catalog.question_created", examId, { questionId: q.id, type: q.type });
    return questionDto(q);
  });
}

export async function updateQuestion(
  ctx: Ctx,
  questionId: string,
  patch: z.infer<typeof questionPatchBody>,
): Promise<QuestionDto> {
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.question.findUnique({ where: { id: questionId }, include: withOptions });
    if (!before) throw notFound("Question not found.");
    const current = questionDto(before);

    if (await isLocked(tx, before.examId)) {
      // Wording only: same type, points and options (by id, with the same correct answers).
      const sameOptions =
        !patch.options ||
        (patch.options.length === current.options.length &&
          patch.options.every((o) => current.options.some((c) => c.id === o.id && c.isCorrect === o.isCorrect)));
      const structural =
        (patch.type !== undefined && patch.type !== current.type) ||
        (patch.points !== undefined && patch.points !== current.points) ||
        !sameOptions;
      if (structural) throw lockedError();
      await tx.question.update({
        where: { id: questionId },
        data: { text: patch.text, imageUrl: patch.imageUrl },
      });
      // sameOptions guaranteed every sent option matches an existing one by id: reword the changed ones.
      for (const existing of current.options) {
        const sent = patch.options?.find((o) => o.id === existing.id);
        if (sent && sent.text !== existing.text)
          await tx.option.update({ where: { id: existing.id }, data: { text: sent.text } });
      }
    } else {
      const merged: QuestionShape = {
        type: patch.type ?? current.type,
        text: patch.text ?? current.text,
        points: patch.points ?? current.points,
        options: patch.options ?? current.options,
      };
      const problems = questionProblems(merged);
      if (problems.length) throw invalid(problems);
      await tx.question.update({
        where: { id: questionId },
        data: { type: patch.type, text: patch.text, imageUrl: patch.imageUrl, points: patch.points },
      });
      if (patch.options) {
        await tx.option.deleteMany({ where: { questionId } });
        await tx.option.createMany({
          data: patch.options.map((o, position) => ({ questionId, text: o.text, isCorrect: o.isCorrect, position })),
        });
      }
    }
    await auditContent(ctx, tx, "catalog.question_updated", before.examId, {
      questionId,
      fields: Object.keys(patch),
    });
    return questionDto(await tx.question.findUniqueOrThrow({ where: { id: questionId }, include: withOptions }));
  });
}

export async function deleteQuestion(ctx: Ctx, questionId: string): Promise<void> {
  await inTransaction(ctx.db, async (tx) => {
    const q = await tx.question.findUnique({ where: { id: questionId } });
    if (!q) throw notFound("Question not found.");
    if (await isLocked(tx, q.examId)) throw lockedError();
    await tx.question.delete({ where: { id: questionId } });
    const rest = await tx.question.findMany({
      where: { examId: q.examId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await renumber(
      tx,
      rest.map((r) => r.id),
    );
    await auditContent(ctx, tx, "catalog.question_deleted", q.examId, { questionId, text: q.text.slice(0, 200) });
  });
}

/** Sets the order; the list must contain every question of the exam exactly once. */
export async function reorderQuestions(ctx: Ctx, examId: string, questionIds: string[]): Promise<QuestionDto[]> {
  return inTransaction(ctx.db, async (tx) => {
    const existing = await tx.question.findMany({ where: { examId }, select: { id: true } });
    const ids = new Set(existing.map((q) => q.id));
    if (
      questionIds.length !== ids.size ||
      new Set(questionIds).size !== ids.size ||
      !questionIds.every((id) => ids.has(id))
    )
      throw invalid(["Send every question of the exam exactly once."], "questionIds");
    await renumber(tx, questionIds);
    await auditContent(ctx, tx, "catalog.questions_reordered", examId, { count: questionIds.length });
    return loadQuestions(tx, examId);
  });
}

/** Imports questions (JSON), all or nothing. Dry run by default: reports problems per question. */
export async function importQuestions(ctx: Ctx, examId: string, input: z.infer<typeof importQuestionsBody>) {
  const errors: { index: number; message: string }[] = [];
  const valid: QuestionInput[] = [];
  input.questions.forEach((raw, index) => {
    const parsed = questionBody.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ index: index + 1, message: `${issue.path.join(".") || "question"}: ${issue.message}` });
      return;
    }
    const problems = questionProblems(parsed.data);
    if (problems.length) for (const message of problems) errors.push({ index: index + 1, message });
    else valid.push(parsed.data);
  });
  const locked = await isLocked(ctx.db, examId);
  if (locked) errors.unshift({ index: 0, message: "Students have already taken this exam: questions can't be added." });
  if (input.dryRun || errors.length)
    return { dryRun: input.dryRun, errors, imported: 0, questions: [] as QuestionDto[] };

  return inTransaction(ctx.db, async (tx) => {
    const last = await tx.question.aggregate({ where: { examId }, _max: { position: true } });
    let position = (last._max.position ?? -1) + 1;
    for (const q of valid) {
      await tx.question.create({
        data: {
          examId,
          type: q.type,
          text: q.text,
          imageUrl: q.imageUrl,
          points: q.points,
          position: position++,
          options: { create: q.options.map((o, i) => ({ ...o, position: i })) },
        },
      });
    }
    await auditContent(ctx, tx, "catalog.questions_imported", examId, { count: valid.length });
    return { dryRun: false, errors, imported: valid.length, questions: await loadQuestions(tx, examId) };
  });
}

// ─────────────────────────────── Materials ───────────────────────────────

export async function listMaterials(ctx: Ctx, examId: string) {
  const rows = await ctx.db.material.findMany({ where: { examId }, orderBy: [{ position: "asc" }, { title: "asc" }] });
  return rows.map(materialDto);
}

export async function createMaterial(ctx: Ctx, examId: string, input: z.infer<typeof materialBody>) {
  return inTransaction(ctx.db, async (tx) => {
    const last = await tx.material.aggregate({ where: { examId }, _max: { position: true } });
    const m = await tx.material.create({ data: { examId, ...input, position: (last._max.position ?? -1) + 1 } });
    await auditContent(ctx, tx, "catalog.material_created", examId, { materialId: m.id, title: m.title });
    return materialDto(m);
  });
}

export async function updateMaterial(ctx: Ctx, materialId: string, patch: z.infer<typeof materialPatchBody>) {
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.material.findUnique({ where: { id: materialId } });
    if (!before) throw notFound("Material not found.");
    const m = await tx.material.update({ where: { id: materialId }, data: patch });
    await auditContent(ctx, tx, "catalog.material_updated", m.examId, { materialId, fields: Object.keys(patch) });
    return materialDto(m);
  });
}

export async function deleteMaterial(ctx: Ctx, materialId: string): Promise<void> {
  await inTransaction(ctx.db, async (tx) => {
    const m = await tx.material.findUnique({ where: { id: materialId } });
    if (!m) throw notFound("Material not found.");
    await tx.material.delete({ where: { id: materialId } });
    await auditContent(ctx, tx, "catalog.material_deleted", m.examId, { materialId, title: m.title });
  });
}

// ─────────────────────────────── Duplicate ───────────────────────────────

/**
 * A new DRAFT copy (settings, tags, questions, materials) in the same category: the way to change
 * a locked exam. Creating it needs EXAM_EDIT on the category, like any new exam.
 */
export async function duplicateExam(ctx: Ctx, examId: string, input: z.infer<typeof duplicateBody>) {
  const actor = actorOf(ctx);
  const source = await ctx.db.exam.findUnique({
    where: { id: examId },
    include: { tags: true, materials: true, questions: { include: withOptions } },
  });
  if (!source) throw notFound("Exam not found.");
  if (!authorize(actor, "EXAM_EDIT", { categoryId: source.categoryId }, ctx.now))
    throw new AppError("FORBIDDEN", { message: "Creating a copy needs edit access to the whole category." });

  try {
    return await inTransaction(ctx.db, async (tx) => {
      const {
        id: _id,
        code: _code,
        title,
        status: _status,
        createdAt: _c,
        updatedAt: _u,
        tags,
        materials,
        questions,
        ...settings
      } = source;
      const copy = await tx.exam.create({
        data: {
          ...settings,
          code: input.code,
          title: input.title ?? `${title} (copy)`,
          status: "DRAFT",
          resultsReleased: false,
          tags: { create: tags.map((t) => ({ tagId: t.tagId })) },
          materials: { create: materials.map((m) => ({ title: m.title, url: m.url, position: m.position })) },
        },
      });
      for (const q of questions) {
        await tx.question.create({
          data: {
            examId: copy.id,
            type: q.type,
            text: q.text,
            imageUrl: q.imageUrl,
            points: q.points,
            position: q.position,
            options: { create: q.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect, position: o.position })) },
          },
        });
      }
      await audit(tx, {
        action: "catalog.exam_duplicated",
        actorId: actor.userId,
        entityType: "Exam",
        entityId: copy.id,
        detail: { from: examId, code: copy.code, questions: questions.length },
        ip: ctx.ip,
      });
      return { id: copy.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That code is already used by another exam.");
    /* v8 ignore next 2 -- any other database error is unexpected; it propagates (500, logged) */
    throw err;
  }
}

/**
 * Refuses publishing an exam that isn't ready (called by updateExam with the settings as they will
 * be after the update, since one PATCH may change them and publish together).
 */
export async function assertPublishable(
  db: DbClient,
  examId: string,
  settings: { isExternal: boolean; questionsPerAttempt: number | null },
) {
  const problems = publishProblems(settings, await loadQuestions(db, examId));
  if (problems.length) throw conflict("This exam isn't ready to publish.", problems);
}

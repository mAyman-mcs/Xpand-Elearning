import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, isUniqueViolation, type DbClient } from "../../core/db.js";
import { AppError, conflict, notFound } from "../../core/errors.js";
import { nonBlank, uuid } from "../../core/schemas.js";
import { AnswerSize, QuestionType, type ExamType, type Prisma } from "../../generated/prisma/client.js";
import { authorize } from "../rbac/authorize.js";
import { assertMayChangeAccessTags } from "./access-tags.js";
import { questionAllowed } from "./exam-types.js";

// Exam content: cases, questions, options, materials, duplication and the publish check
// (docs/NEXT_PLAN.md §2, B5; cases: docs/CASE_QUESTIONS_PLAN.md). Staff-only: these DTOs include the
// answer key (isCorrect), option explanations and grader guidance, and must never be served to students.
//
// A case's questions are always contiguous in the exam's question order (`position`): the case sits
// where its first question is. Every change below keeps that true.

const ESSAY_NEEDS_TYPE = "Essay questions need the “Multiple choice + essay” exam type.";

// ─────────────────────────────── Pure rules ───────────────────────────────

export interface QuestionShape {
  type: QuestionType;
  text: string;
  points: number;
  imageId?: string | null;
  imageAlt?: string | null;
  options: { text: string; isCorrect: boolean; imageId?: string | null; imageAlt?: string | null }[];
}

/** What makes one question unusable, in words (empty = valid). */
export function questionProblems(q: QuestionShape): string[] {
  const problems: string[] = [];
  const correct = q.options.filter((o) => o.isCorrect).length;
  if (!q.text.trim()) problems.push("The question has no text.");
  if (!(q.points > 0)) problems.push("Points must be more than 0.");
  if (q.imageId && !q.imageAlt?.trim()) problems.push("Describe the question's picture (alt text).");
  if (q.type === "ESSAY") {
    if (q.options.length) problems.push("Essay questions have no options.");
    return problems;
  }
  if (q.options.some((o) => !o.text.trim() && !o.imageId)) problems.push("An option has no text or picture.");
  if (q.options.some((o) => o.imageId && !o.imageAlt?.trim()))
    problems.push("Describe every option picture (alt text).");
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
  exam: { isExternal: boolean; questionsPerAttempt: number | null; type: ExamType },
  questions: QuestionShape[],
  cases: { title: string; questionCount: number }[] = [],
): string[] {
  if (exam.isExternal) return [];
  const problems: string[] = [];
  if (questions.length === 0) problems.push("Add at least one question.");
  questions.forEach((q, i) => {
    for (const p of questionProblems(q)) problems.push(`Question ${i + 1}: ${p}`);
    if (!questionAllowed(exam.type, q.type)) problems.push(`Question ${i + 1}: ${ESSAY_NEEDS_TYPE}`);
  });
  for (const c of cases)
    if (c.questionCount === 0) problems.push(`Case “${c.title}” has no questions: add some or delete it.`);
  // An essay exam without essays would need grading for nothing (T2).
  if (exam.type === "MCQ_ESSAY" && questions.length > 0 && !questions.some((q) => q.type === "ESSAY"))
    problems.push("Add at least one essay question, or change the exam type to “Multiple choice only”.");
  // Random draws come with question pools (NEXT_PLAN E3, B12); until then the setting would be ignored.
  if (exam.questionsPerAttempt !== null)
    problems.push("“Questions per attempt” must be empty until question pools arrive.");
  return problems;
}

/** Are the questions of every case next to each other in this order? */
export function casesContiguous(order: { id: string; caseId: string | null }[]): boolean {
  const closed = new Set<string>();
  let current: string | null = null;
  for (const q of order) {
    if (q.caseId !== current) {
      if (current) closed.add(current);
      if (q.caseId && closed.has(q.caseId)) return false;
      current = q.caseId;
    }
  }
  return true;
}

/**
 * Where a question joins a case: right after the case's last question, or at the end when the case
 * is still empty. `order` is the exam's order without the question.
 */
export function insertIntoCase(order: { id: string; caseId: string | null }[], id: string, caseId: string): string[] {
  const ids = order.map((q) => q.id);
  const last = order.map((q) => q.caseId).lastIndexOf(caseId);
  ids.splice(last < 0 ? ids.length : last + 1, 0, id);
  return ids;
}

// ─────────────────────────────── Schemas ───────────────────────────────

const httpsUrl = z.url({ protocol: /^https$/, error: "Use a full https:// link" }).max(2000);
/** Optional text: blank becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
const optionInput = z.object({
  text: z.string().trim().max(1000).default(""),
  isCorrect: z.boolean(),
  /** A neutral second line shown to students under the text. */
  detail: optionalText(300).default(null),
  imageId: uuid.nullable().default(null),
  imageAlt: optionalText(300).default(null),
  /** Why the option is right or wrong: staff only. */
  explanation: optionalText(2000).default(null),
});
const questionFields = {
  type: z.enum(QuestionType),
  text: nonBlank(5000),
  imageUrl: httpsUrl.nullable(),
  imageId: uuid.nullable(),
  imageAlt: optionalText(300),
  points: z.number().positive().max(100),
  /** ESSAY only: notes for graders, never shown to students. */
  guidance: z.string().trim().max(5000).nullable(),
  /** ESSAY only: a one-line answer (SHORT) or a text area (LONG). */
  answerSize: z.enum(AnswerSize),
  /** The case this question belongs to (null = a question on its own). */
  caseId: uuid.nullable(),
};

export const questionBody = z.object({
  ...questionFields,
  imageUrl: questionFields.imageUrl.default(null),
  imageId: questionFields.imageId.default(null),
  imageAlt: questionFields.imageAlt.default(null),
  points: questionFields.points.default(1),
  guidance: questionFields.guidance.default(null),
  answerSize: questionFields.answerSize.default("LONG"),
  caseId: questionFields.caseId.default(null),
  options: z.array(optionInput).max(10).default([]),
});
export type QuestionInput = z.infer<typeof questionBody>;

/** Options are replaced as a whole; ids identify existing options (needed once the exam is locked). */
export const questionPatchBody = z
  .object({ ...questionFields, options: z.array(optionInput.extend({ id: uuid.optional() })).max(10) })
  .partial();

const caseFields = {
  /** A short chip such as KNOWLEDGE, DESIGN, FILL IN or TROUBLESHOOT. */
  label: optionalText(20),
  title: nonBlank(200),
  situation: nonBlank(5000),
  hint: optionalText(1000),
  imageId: uuid.nullable(),
  imageAlt: optionalText(300),
};
export const caseBody = z.object({
  ...caseFields,
  label: caseFields.label.default(null),
  hint: caseFields.hint.default(null),
  imageId: caseFields.imageId.default(null),
  imageAlt: caseFields.imageAlt.default(null),
});
export const casePatchBody = z.object(caseFields).partial();

export const reorderBody = z.object({ questionIds: z.array(uuid).max(500) });

/** A case in an import: its fields and its questions (which join it, so they carry no caseId). */
const importCase = caseBody.extend({ questions: z.array(z.unknown()).max(50).default([]) });
export const importQuestionsBody = z
  .object({
    questions: z.array(z.unknown()).max(200).default([]),
    cases: z.array(z.unknown()).max(50).default([]),
    dryRun: z.boolean().default(true),
  })
  .refine((b) => b.questions.length > 0 || b.cases.length > 0, {
    message: "No questions to import",
    path: ["questions"],
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
    imageId: q.imageId,
    imageAlt: q.imageAlt,
    points: q.points.toNumber(),
    position: q.position,
    guidance: q.guidance,
    answerSize: q.answerSize,
    caseId: q.caseId,
    options: q.options.map((o) => ({
      id: o.id,
      text: o.text,
      detail: o.detail,
      imageId: o.imageId,
      imageAlt: o.imageAlt,
      isCorrect: o.isCorrect,
      explanation: o.explanation,
      position: o.position,
    })),
  };
}
type QuestionDto = ReturnType<typeof questionDto>;

type CaseRow = Prisma.QuestionCaseGetPayload<object>;
export function caseDto(c: CaseRow) {
  return {
    id: c.id,
    label: c.label,
    title: c.title,
    situation: c.situation,
    hint: c.hint,
    imageId: c.imageId,
    imageAlt: c.imageAlt,
  };
}
type CaseDto = ReturnType<typeof caseDto>;

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
    "Students have already taken this exam: only the wording of questions, options and cases can change. Duplicate the exam to change more.",
  );

const notAllowed = () => invalid([`${ESSAY_NEEDS_TYPE} Change it in the exam settings.`], "type");

/** Grader notes and answer sizes belong to essays only; other types store none. */
const guidanceFor = (type: QuestionType, guidance: string | null | undefined) =>
  type === "ESSAY" ? guidance || null : null;
const answerSizeFor = (type: QuestionType, size: AnswerSize): AnswerSize => (type === "ESSAY" ? size : "LONG");

async function examTypeOf(db: DbClient, examId: string): Promise<ExamType> {
  const exam = await db.exam.findUnique({ where: { id: examId }, select: { type: true } });
  /* v8 ignore next -- callers are behind the route's exam scope, which already answered 404 */
  if (!exam) throw notFound("Exam not found.");
  return exam.type;
}

/** An exam with attempts is locked: grades must stay explainable (NEXT_PLAN E1). */
async function isLocked(db: DbClient, examId: string): Promise<boolean> {
  return (await db.attempt.count({ where: { examId } })) > 0;
}

async function loadQuestions(db: DbClient, examId: string): Promise<QuestionDto[]> {
  const rows = await db.question.findMany({ where: { examId }, include: withOptions, orderBy: { position: "asc" } });
  return rows.map(questionDto);
}

async function loadCases(db: DbClient, examId: string): Promise<CaseDto[]> {
  const rows = await db.questionCase.findMany({ where: { examId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map(caseDto);
}

/** The exam's question order with each question's case. */
const orderOf = (db: DbClient, examId: string) =>
  db.question.findMany({ where: { examId }, orderBy: { position: "asc" }, select: { id: true, caseId: true } });

/** Positions 0..n-1 in the given order (after deletes, moves and reorders). Only changed rows are written. */
async function renumber(tx: Prisma.TransactionClient, examId: string, ids: string[]) {
  const current = new Map(
    (await tx.question.findMany({ where: { examId }, select: { id: true, position: true } })).map((q) => [
      q.id,
      q.position,
    ]),
  );
  for (const [position, id] of ids.entries())
    if (current.get(id) !== position) await tx.question.update({ where: { id }, data: { position } });
}

/** A case must belong to the exam. */
async function assertCaseOf(db: DbClient, examId: string, caseId: string | null | undefined) {
  if (!caseId) return;
  const c = await db.questionCase.findUnique({ where: { id: caseId }, select: { examId: true } });
  if (c?.examId !== examId) throw invalid(["That case isn't part of this exam."], "caseId");
}

/**
 * Pictures must be uploaded for this exam, or already used by it (a copied exam keeps its source's
 * pictures). Stops one exam's editor from pointing at pictures of an exam they can't see.
 */
async function assertUploadsOf(db: DbClient, examId: string, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return;
  const rows = await db.upload.findMany({ where: { id: { in: wanted } }, select: { id: true, examId: true } });
  const foreign = wanted.filter((id) => rows.find((r) => r.id === id)?.examId !== examId);
  if (!foreign.length) return;
  const [questions, options, cases] = await Promise.all([
    db.question.findMany({ where: { examId, imageId: { in: foreign } }, select: { imageId: true } }),
    db.option.findMany({ where: { question: { examId }, imageId: { in: foreign } }, select: { imageId: true } }),
    db.questionCase.findMany({ where: { examId, imageId: { in: foreign } }, select: { imageId: true } }),
  ]);
  const used = new Set([...questions, ...options, ...cases].map((r) => r.imageId));
  if (foreign.some((id) => !used.has(id))) throw invalid(["Upload the picture to this exam first."], "imageId");
}

const imageIdsOf = (q: { imageId?: string | null; options?: { imageId?: string | null }[] }) => [
  q.imageId,
  ...(q.options ?? []).map((o) => o.imageId),
];

async function auditContent(
  ctx: Ctx,
  tx: Prisma.TransactionClient,
  action: string,
  examId: string,
  detail: Prisma.InputJsonObject,
) {
  await audit(tx, { action, actorId: actorOf(ctx).userId, entityType: "Exam", entityId: examId, detail, ip: ctx.ip });
}

const optionRows = (options: QuestionInput["options"]) =>
  options.map((o, position) => ({
    text: o.text,
    isCorrect: o.isCorrect,
    detail: o.detail,
    imageId: o.imageId,
    imageAlt: o.imageId ? o.imageAlt : null,
    explanation: o.explanation,
    position,
  }));

const questionData = (q: Omit<QuestionInput, "options" | "caseId">) => ({
  type: q.type,
  text: q.text,
  imageUrl: q.imageUrl,
  imageId: q.imageId,
  imageAlt: q.imageId ? q.imageAlt : null,
  points: q.points,
  guidance: guidanceFor(q.type, q.guidance),
  answerSize: answerSizeFor(q.type, q.answerSize),
});

// ─────────────────────────────── Questions ───────────────────────────────

/** The exam's cases and questions with the answer key, whether it is locked, and what blocks publishing. */
export async function listQuestions(ctx: Ctx, examId: string) {
  const exam = await ctx.db.exam.findUnique({
    where: { id: examId },
    select: { isExternal: true, questionsPerAttempt: true, type: true },
  });
  /* v8 ignore next -- the route's exam scope already answered 404 */
  if (!exam) throw notFound("Exam not found.");
  const [questions, cases] = await Promise.all([loadQuestions(ctx.db, examId), loadCases(ctx.db, examId)]);
  return {
    locked: await isLocked(ctx.db, examId),
    questions,
    cases,
    publishProblems: publishProblems(exam, questions, caseCounts(cases, questions)),
  };
}

const caseCounts = (cases: CaseDto[], questions: { caseId: string | null }[]) =>
  cases.map((c) => ({ title: c.title, questionCount: questions.filter((q) => q.caseId === c.id).length }));

export async function createQuestion(ctx: Ctx, examId: string, input: QuestionInput): Promise<QuestionDto> {
  const problems = questionProblems(input);
  if (problems.length) throw invalid(problems);
  return inTransaction(ctx.db, async (tx) => {
    if (!questionAllowed(await examTypeOf(tx, examId), input.type)) throw notAllowed();
    if (await isLocked(tx, examId)) throw lockedError();
    await assertCaseOf(tx, examId, input.caseId);
    await assertUploadsOf(tx, examId, imageIdsOf(input));
    const before = await orderOf(tx, examId);
    const q = await tx.question.create({
      data: {
        examId,
        ...questionData(input),
        caseId: input.caseId,
        position: before.length,
        options: { create: optionRows(input.options) },
      },
    });
    if (input.caseId) await renumber(tx, examId, insertIntoCase(before, q.id, input.caseId));
    await auditContent(ctx, tx, "catalog.question_created", examId, {
      questionId: q.id,
      type: q.type,
      ...(input.caseId ? { caseId: input.caseId } : {}),
    });
    return questionDto(await tx.question.findUniqueOrThrow({ where: { id: q.id }, include: withOptions }));
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
    const examId = before.examId;
    await assertUploadsOf(tx, examId, imageIdsOf(patch));
    const imageAlt = (imageId: string | null, alt: string | null) => (imageId ? alt : null);

    if (await isLocked(tx, examId)) {
      // Wording only: same type, points, case and options (by id, with the same correct answers).
      const sameOptions =
        !patch.options ||
        (patch.options.length === current.options.length &&
          patch.options.every((o) => current.options.some((c) => c.id === o.id && c.isCorrect === o.isCorrect)));
      const structural =
        (patch.type !== undefined && patch.type !== current.type) ||
        (patch.points !== undefined && patch.points !== current.points) ||
        (patch.caseId !== undefined && patch.caseId !== current.caseId) ||
        (patch.answerSize !== undefined && current.type === "ESSAY" && patch.answerSize !== current.answerSize) ||
        !sameOptions;
      if (structural) throw lockedError();
      const merged: QuestionShape = {
        ...current,
        text: patch.text ?? current.text,
        imageId: patch.imageId !== undefined ? patch.imageId : current.imageId,
        imageAlt: patch.imageAlt !== undefined ? patch.imageAlt : current.imageAlt,
        options: current.options.map((c) => ({ ...c, ...patch.options?.find((o) => o.id === c.id) })),
      };
      const problems = questionProblems(merged);
      if (problems.length) throw invalid(problems);
      // Pictures, alt text, explanations and grader guidance are wording too: they never change a score.
      await tx.question.update({
        where: { id: questionId },
        data: {
          text: patch.text,
          imageUrl: patch.imageUrl,
          imageId: patch.imageId,
          imageAlt: imageAlt(merged.imageId ?? null, merged.imageAlt ?? null),
          guidance: patch.guidance !== undefined ? guidanceFor(current.type, patch.guidance) : undefined,
        },
      });
      // sameOptions guaranteed every sent option matches an existing one by id: reword the changed ones.
      for (const existing of current.options) {
        const sent = patch.options?.find((o) => o.id === existing.id);
        if (!sent) continue;
        const next = {
          text: sent.text,
          detail: sent.detail,
          imageId: sent.imageId,
          imageAlt: imageAlt(sent.imageId, sent.imageAlt),
          explanation: sent.explanation,
        };
        const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => next[k] !== existing[k]);
        if (changed) await tx.option.update({ where: { id: existing.id }, data: next });
      }
    } else {
      const merged = {
        type: patch.type ?? current.type,
        text: patch.text ?? current.text,
        points: patch.points ?? current.points,
        imageId: patch.imageId !== undefined ? patch.imageId : current.imageId,
        imageAlt: patch.imageAlt !== undefined ? patch.imageAlt : current.imageAlt,
        options: patch.options ?? current.options,
      };
      const problems = questionProblems(merged);
      if (problems.length) throw invalid(problems);
      if (!questionAllowed(await examTypeOf(tx, examId), merged.type)) throw notAllowed();
      await tx.question.update({
        where: { id: questionId },
        data: {
          type: patch.type,
          text: patch.text,
          imageUrl: patch.imageUrl,
          imageId: patch.imageId,
          imageAlt: imageAlt(merged.imageId, merged.imageAlt),
          points: patch.points,
          guidance: guidanceFor(merged.type, patch.guidance !== undefined ? patch.guidance : current.guidance),
          answerSize: answerSizeFor(merged.type, patch.answerSize ?? current.answerSize),
        },
      });
      if (patch.options) {
        await tx.option.deleteMany({ where: { questionId } });
        await tx.option.createMany({ data: optionRows(patch.options).map((o) => ({ ...o, questionId })) });
      }
      if (patch.caseId !== undefined && patch.caseId !== current.caseId) {
        await assertCaseOf(tx, examId, patch.caseId);
        const order = await orderOf(tx, examId);
        const rest = order.filter((q) => q.id !== questionId);
        let ids: string[];
        if (patch.caseId) ids = insertIntoCase(rest, questionId, patch.caseId);
        else {
          // Out of its case: right after the case's remaining questions (or where it was).
          const lastOfCase = rest.map((q) => q.caseId).lastIndexOf(current.caseId);
          ids = rest.map((q) => q.id);
          ids.splice(lastOfCase < 0 ? order.findIndex((q) => q.id === questionId) : lastOfCase + 1, 0, questionId);
        }
        await tx.question.update({ where: { id: questionId }, data: { caseId: patch.caseId } });
        await renumber(tx, examId, ids);
      }
    }
    await auditContent(ctx, tx, "catalog.question_updated", examId, {
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
    await renumber(
      tx,
      q.examId,
      (await orderOf(tx, q.examId)).map((r) => r.id),
    );
    await auditContent(ctx, tx, "catalog.question_deleted", q.examId, { questionId, text: q.text.slice(0, 200) });
  });
}

/** Sets the order; the list must contain every question of the exam exactly once, with each case together. */
export async function reorderQuestions(ctx: Ctx, examId: string, questionIds: string[]): Promise<QuestionDto[]> {
  return inTransaction(ctx.db, async (tx) => {
    const existing = await orderOf(tx, examId);
    const caseOf = new Map(existing.map((q) => [q.id, q.caseId]));
    if (
      questionIds.length !== caseOf.size ||
      new Set(questionIds).size !== caseOf.size ||
      !questionIds.every((id) => caseOf.has(id))
    )
      throw invalid(["Send every question of the exam exactly once."], "questionIds");
    if (!casesContiguous(questionIds.map((id) => ({ id, caseId: caseOf.get(id) ?? null }))))
      throw invalid(["Keep the questions of a case together."], "questionIds");
    await renumber(tx, examId, questionIds);
    await auditContent(ctx, tx, "catalog.questions_reordered", examId, { count: questionIds.length });
    return loadQuestions(tx, examId);
  });
}

/**
 * Imports questions and cases (JSON), all or nothing. Dry run by default: reports problems per
 * question. Loose questions are added first, then each case with its questions, after the existing ones.
 */
export async function importQuestions(ctx: Ctx, examId: string, input: z.infer<typeof importQuestionsBody>) {
  const errors: { index: number; message: string }[] = [];
  const examType = await examTypeOf(ctx.db, examId);
  let index = 0;

  const parseQuestion = (raw: unknown, where: string): QuestionInput | null => {
    index += 1;
    const parsed = questionBody.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ index, message: `${where}${issue.path.join(".") || "question"}: ${issue.message}` });
      return null;
    }
    const problems = questionProblems(parsed.data);
    if (!questionAllowed(examType, parsed.data.type)) problems.push(ESSAY_NEEDS_TYPE);
    if (parsed.data.caseId) problems.push("caseId: leave it out; put the question inside its case instead.");
    for (const message of problems) errors.push({ index, message: `${where}${message}` });
    return problems.length ? null : parsed.data;
  };

  const loose = input.questions.map((raw) => parseQuestion(raw, ""));
  const cases = input.cases.map((raw, c) => {
    const where = `Case ${c + 1}: `;
    const parsed = importCase.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({ index: 0, message: `${where}${issue.path.join(".") || "case"}: ${issue.message}` });
      return null;
    }
    if (parsed.data.imageId && !parsed.data.imageAlt)
      errors.push({ index: 0, message: `${where}Describe the case's picture (alt text).` });
    const questions = parsed.data.questions.map((q, i) => parseQuestion(q, `${where}question ${i + 1}: `));
    return { ...parsed.data, questions };
  });

  // Past the error check below, every entry parsed: this only narrows the type.
  const valid = (qs: (QuestionInput | null)[]) => qs.filter((q): q is QuestionInput => q !== null);
  const all = valid([...loose, ...cases.flatMap((c) => c?.questions ?? [])]);
  try {
    await assertUploadsOf(ctx.db, examId, [...all.flatMap(imageIdsOf), ...cases.map((c) => c?.imageId)]);
  } catch {
    errors.push({ index: 0, message: "A picture isn't uploaded to this exam: upload it first and use its id." });
  }
  if (await isLocked(ctx.db, examId))
    errors.unshift({ index: 0, message: "Students have already taken this exam: questions can't be added." });
  if (input.dryRun || errors.length)
    return { dryRun: input.dryRun, errors, imported: 0, questions: [] as QuestionDto[] };

  return inTransaction(ctx.db, async (tx) => {
    let position = await tx.question.count({ where: { examId } });
    const create = (q: QuestionInput, caseId: string | null) =>
      tx.question.create({
        data: { examId, ...questionData(q), caseId, position: position++, options: { create: optionRows(q.options) } },
      });
    for (const q of valid(loose)) await create(q, null);
    for (const c of cases) {
      /* v8 ignore next -- a case that failed to parse was reported as an error above */
      if (!c) continue;
      const row = await tx.questionCase.create({
        data: {
          examId,
          label: c.label,
          title: c.title,
          situation: c.situation,
          hint: c.hint,
          imageId: c.imageId,
          imageAlt: c.imageId ? c.imageAlt : null,
        },
      });
      for (const q of valid(c.questions)) await create(q, row.id);
    }
    await auditContent(ctx, tx, "catalog.questions_imported", examId, { count: all.length, cases: cases.length });
    return { dryRun: false, errors, imported: all.length, questions: await loadQuestions(tx, examId) };
  });
}

// ─────────────────────────────── Cases ───────────────────────────────

export async function createCase(ctx: Ctx, examId: string, input: z.infer<typeof caseBody>): Promise<CaseDto> {
  if (input.imageId && !input.imageAlt) throw invalid(["Describe the case's picture (alt text)."], "imageAlt");
  return inTransaction(ctx.db, async (tx) => {
    await examTypeOf(tx, examId);
    if (await isLocked(tx, examId)) throw lockedError();
    await assertUploadsOf(tx, examId, [input.imageId]);
    const c = await tx.questionCase.create({
      data: { examId, ...input, imageAlt: input.imageId ? input.imageAlt : null },
    });
    await auditContent(ctx, tx, "catalog.case_created", examId, { caseId: c.id, title: c.title });
    return caseDto(c);
  });
}

/** Cases are wording: they can change even once the exam is locked. */
export async function updateCase(ctx: Ctx, caseId: string, patch: z.infer<typeof casePatchBody>): Promise<CaseDto> {
  return inTransaction(ctx.db, async (tx) => {
    const before = await tx.questionCase.findUnique({ where: { id: caseId } });
    /* v8 ignore next -- the route's case scope already answered 404 */
    if (!before) throw notFound("Case not found.");
    const imageId = patch.imageId !== undefined ? patch.imageId : before.imageId;
    const imageAlt = patch.imageAlt !== undefined ? patch.imageAlt : before.imageAlt;
    if (imageId && !imageAlt) throw invalid(["Describe the case's picture (alt text)."], "imageAlt");
    await assertUploadsOf(tx, before.examId, [patch.imageId]);
    const c = await tx.questionCase.update({
      where: { id: caseId },
      data: { ...patch, imageAlt: imageId ? imageAlt : null },
    });
    await auditContent(ctx, tx, "catalog.case_updated", before.examId, { caseId, fields: Object.keys(patch) });
    return caseDto(c);
  });
}

/** Deletes a case and its questions (refused once students have taken the exam). */
export async function deleteCase(ctx: Ctx, caseId: string): Promise<void> {
  await inTransaction(ctx.db, async (tx) => {
    const c = await tx.questionCase.findUnique({
      where: { id: caseId },
      include: { _count: { select: { questions: true } } },
    });
    /* v8 ignore next -- the route's case scope already answered 404 */
    if (!c) throw notFound("Case not found.");
    if (await isLocked(tx, c.examId)) throw lockedError();
    await tx.questionCase.delete({ where: { id: caseId } }); // its questions cascade
    await renumber(
      tx,
      c.examId,
      (await orderOf(tx, c.examId)).map((r) => r.id),
    );
    await auditContent(ctx, tx, "catalog.case_deleted", c.examId, {
      caseId,
      title: c.title,
      questions: c._count.questions,
    });
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
 * A new DRAFT copy (settings, tags, cases, questions, materials) in the same category: the way to
 * change a locked exam. Pictures are shared, not copied (uploads never change). Creating it needs
 * EXAM_EDIT on the category, like any new exam.
 */
export async function duplicateExam(ctx: Ctx, examId: string, input: z.infer<typeof duplicateBody>) {
  const actor = actorOf(ctx);
  const source = await ctx.db.exam.findUnique({
    where: { id: examId },
    include: { tags: true, materials: true, cases: true, questions: { include: withOptions } },
  });
  if (!source) throw notFound("Exam not found.");
  if (!authorize(actor, "EXAM_EDIT", { categoryId: source.categoryId }, ctx.now))
    throw new AppError("FORBIDDEN", { message: "Creating a copy needs edit access to the whole category." });
  // The copy would carry the tags: an access tag on a new exam widens someone's access.
  await assertMayChangeAccessTags(
    ctx.db,
    actor,
    source.tags.map((t) => t.tagId),
  );

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
        cases,
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
      const caseIds = new Map<string, string>();
      for (const c of cases) {
        const row = await tx.questionCase.create({
          data: {
            examId: copy.id,
            label: c.label,
            title: c.title,
            situation: c.situation,
            hint: c.hint,
            imageId: c.imageId,
            imageAlt: c.imageAlt,
            createdAt: c.createdAt,
          },
        });
        caseIds.set(c.id, row.id);
      }
      for (const q of questions) {
        await tx.question.create({
          data: {
            examId: copy.id,
            type: q.type,
            text: q.text,
            imageUrl: q.imageUrl,
            imageId: q.imageId,
            imageAlt: q.imageAlt,
            points: q.points,
            guidance: q.guidance,
            answerSize: q.answerSize,
            caseId: q.caseId ? (caseIds.get(q.caseId) ?? null) : null,
            position: q.position,
            options: {
              create: q.options.map((o) => ({
                text: o.text,
                detail: o.detail,
                imageId: o.imageId,
                imageAlt: o.imageAlt,
                isCorrect: o.isCorrect,
                explanation: o.explanation,
                position: o.position,
              })),
            },
          },
        });
      }
      await audit(tx, {
        action: "catalog.exam_duplicated",
        actorId: actor.userId,
        entityType: "Exam",
        entityId: copy.id,
        detail: { from: examId, code: copy.code, questions: questions.length, cases: cases.length },
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
  settings: { isExternal: boolean; questionsPerAttempt: number | null; type: ExamType },
) {
  const [questions, cases] = await Promise.all([loadQuestions(db, examId), loadCases(db, examId)]);
  const problems = publishProblems(settings, questions, caseCounts(cases, questions));
  if (problems.length) throw conflict("This exam isn't ready to publish.", problems);
}

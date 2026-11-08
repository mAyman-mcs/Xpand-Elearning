import { createHash } from "node:crypto";
import { z } from "zod";
import { audit } from "../../core/audit.js";
import { actorOf, type Ctx } from "../../core/context.js";
import { inTransaction, type DbClient } from "../../core/db.js";
import { AppError, notFound } from "../../core/errors.js";
import { FileReply } from "../../core/route.js";
import { uuid } from "../../core/schemas.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { canSeeAnything } from "../rbac/authorize.js";
import { examScope } from "../rbac/resolvers.js";
import { sanitizeImage } from "./image.js";

// Uploaded pictures for questions, options and cases (docs/CASE_QUESTIONS_PLAN.md §3.1, C7–C8).

export const uploadQuery = z.object({ examId: uuid });
/** The raw request body (express.raw), present only for the accepted picture types. */
export const uploadBody = z.instanceof(Buffer, { message: "Send a PNG, JPEG or WebP picture as the request body." });

export const uploadUrl = (id: string) => `/api/uploads/${id}`;

export async function uploadImage(ctx: Ctx, examId: string, body: Buffer) {
  const image = sanitizeImage(body);
  if ("problem" in image)
    throw new AppError("VALIDATION_FAILED", {
      message: image.problem,
      details: [{ path: "file", message: image.problem }],
    });
  const actorId = actorOf(ctx).userId;
  const sha256 = createHash("sha256").update(image.data).digest("hex");
  return inTransaction(ctx.db, async (tx) => {
    const row = await tx.upload.create({
      data: {
        examId,
        mime: image.mime,
        size: image.data.length,
        sha256,
        width: image.width,
        height: image.height,
        data: new Uint8Array(image.data),
        createdById: actorId,
      },
      select: { id: true, mime: true, size: true, width: true, height: true },
    });
    await audit(tx, {
      action: "uploads.created",
      actorId,
      entityType: "Exam",
      entityId: examId,
      detail: { uploadId: row.id, mime: row.mime, size: row.size, sha256 },
      ip: ctx.ip,
    });
    return { ...row, url: uploadUrl(row.id) };
  });
}

/** Questions, options or cases using this picture, as a filter on questions. */
const usesUpload = (id: string): Prisma.QuestionWhereInput => ({
  OR: [{ imageId: id }, { options: { some: { imageId: id } } }, { case: { is: { imageId: id } } }],
});

/** Exams whose content uses the picture (a copied exam reuses its source's pictures). */
async function examsUsing(db: DbClient, id: string): Promise<string[]> {
  const [questions, cases] = await Promise.all([
    db.question.findMany({ where: usesUpload(id), select: { examId: true }, distinct: ["examId"] }),
    db.questionCase.findMany({ where: { imageId: id }, select: { examId: true }, distinct: ["examId"] }),
  ]);
  return [...new Set([...questions, ...cases].map((r) => r.examId))];
}

/**
 * Who may load a picture (C8): staff who can see the exam it was uploaded for or an exam using it;
 * a student only while taking an exam whose questions use it. Anyone else: not found.
 */
export async function readUpload(ctx: Ctx, id: string): Promise<FileReply> {
  const upload = await ctx.db.upload.findUnique({ where: { id }, select: { examId: true, mime: true, data: true } });
  if (!upload) throw notFound();
  const actor = actorOf(ctx);

  let allowed = false;
  if (actor.role === "STUDENT") {
    const open = await ctx.db.attempt.findMany({
      where: { userId: actor.userId, status: "IN_PROGRESS" },
      select: { examId: true },
    });
    if (open.length)
      allowed =
        (await ctx.db.question.count({ where: { examId: { in: open.map((a) => a.examId) }, ...usesUpload(id) } })) > 0;
  } else {
    for (const examId of [upload.examId, ...(await examsUsing(ctx.db, id))]) {
      if (canSeeAnything(actor, await examScope(ctx.db, examId), ctx.now)) {
        allowed = true;
        break;
      }
    }
  }
  if (!allowed) throw notFound();
  return new FileReply(upload.mime, Buffer.from(upload.data));
}

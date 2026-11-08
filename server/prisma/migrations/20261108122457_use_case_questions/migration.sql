-- CreateEnum
CREATE TYPE "AnswerSize" AS ENUM ('SHORT', 'LONG');

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "intro" TEXT,
ADD COLUMN     "showHints" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Option" ADD COLUMN     "detail" TEXT,
ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "imageId" UUID,
ALTER COLUMN "text" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "answerSize" "AnswerSize" NOT NULL DEFAULT 'LONG',
ADD COLUMN     "caseId" UUID,
ADD COLUMN     "imageAlt" TEXT,
ADD COLUMN     "imageId" UUID;

-- CreateTable
CREATE TABLE "QuestionCase" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "label" TEXT,
    "title" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "hint" TEXT,
    "imageId" UUID,
    "imageAlt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionCase_examId_idx" ON "QuestionCase"("examId");

-- CreateIndex
CREATE INDEX "Upload_examId_idx" ON "Upload"("examId");

-- CreateIndex
CREATE INDEX "Question_caseId_idx" ON "Question"("caseId");

-- AddForeignKey
ALTER TABLE "QuestionCase" ADD CONSTRAINT "QuestionCase_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionCase" ADD CONSTRAINT "QuestionCase_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "QuestionCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- docs/CASE_QUESTIONS_PLAN.md §2: an option is text or a picture; every uploaded picture has alt text.
ALTER TABLE "Option" ADD CONSTRAINT "Option_text_or_image"
  CHECK ("text" <> '' OR "imageId" IS NOT NULL);
ALTER TABLE "Option" ADD CONSTRAINT "Option_image_alt"
  CHECK ("imageId" IS NULL OR "imageAlt" IS NOT NULL);
ALTER TABLE "Question" ADD CONSTRAINT "Question_image_alt"
  CHECK ("imageId" IS NULL OR "imageAlt" IS NOT NULL);
ALTER TABLE "QuestionCase" ADD CONSTRAINT "QuestionCase_image_alt"
  CHECK ("imageId" IS NULL OR "imageAlt" IS NOT NULL);

-- Uploads are at most 2 MB (also checked by the API).
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_size"
  CHECK ("size" > 0 AND "size" <= 2097152 AND octet_length("data") = "size");

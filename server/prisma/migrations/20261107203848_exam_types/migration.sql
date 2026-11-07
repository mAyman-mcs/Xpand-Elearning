-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('MCQ', 'MCQ_ESSAY');

-- CreateEnum
CREATE TYPE "ScoringMode" AS ENUM ('AUTO', 'MANUAL_APPROVAL');

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'ESSAY';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "gradingVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AttemptAnswer" ADD COLUMN     "autoPoints" DECIMAL(6,2),
ADD COLUMN     "awardedPoints" DECIMAL(6,2),
ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "gradedAt" TIMESTAMP(3),
ADD COLUMN     "gradedById" UUID,
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "text" TEXT,
ALTER COLUMN "selectedOptionIds" SET DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "scoringMode" "ScoringMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "type" "ExamType" NOT NULL DEFAULT 'MCQ';

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "guidance" TEXT;

-- CreateIndex
CREATE INDEX "Attempt_examId_reviewStatus_idx" ON "Attempt"("examId", "reviewStatus");

-- Essay exams are always graded by staff (docs/EXAM_TYPES_PLAN.md §2).
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_essay_needs_approval"
  CHECK (NOT ("type" = 'MCQ_ESSAY' AND "scoringMode" = 'AUTO'));

-- Essay answers are capped at 10,000 characters (also checked by the API).
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_text_length"
  CHECK ("text" IS NULL OR char_length("text") <= 10000);

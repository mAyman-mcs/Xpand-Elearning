-- Catalog taxonomy (categories, tags), category-scoped grants, and attempt review status.

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'REVIEWED');

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'ATTEMPT_REVIEW';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" UUID;

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamTag" (
    "examId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "ExamTag_pkey" PRIMARY KEY ("examId","tagId")
);

-- CreateTable
CREATE TABLE "GrantCategory" (
    "grantId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "GrantCategory_pkey" PRIMARY KEY ("grantId","categoryId")
);

-- Exam.categoryId is required (decision D1). Existing exams, if any, move to a "General" category.
ALTER TABLE "Exam" ADD COLUMN "categoryId" UUID;
INSERT INTO "Category" ("id", "name", "slug")
  SELECT gen_random_uuid(), 'General', 'general' WHERE EXISTS (SELECT 1 FROM "Exam");
UPDATE "Exam" SET "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'general') WHERE "categoryId" IS NULL;
ALTER TABLE "Exam" ALTER COLUMN "categoryId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");
CREATE INDEX "ExamTag_tagId_idx" ON "ExamTag"("tagId");
CREATE INDEX "Exam_categoryId_idx" ON "Exam"("categoryId");

-- Names are unique regardless of case ("Cloud" vs "cloud"); slugs are lowercase-kebab.
CREATE UNIQUE INDEX "Category_name_ci_key" ON "Category" (lower("name"));
CREATE UNIQUE INDEX "Tag_name_ci_key" ON "Tag" (lower("name"));
ALTER TABLE "Category" ADD CONSTRAINT "Category_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Category" ADD CONSTRAINT "Category_name_not_blank" CHECK (length(trim("name")) > 0);
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_name_not_blank" CHECK (length(trim("name")) > 0);

-- AddForeignKey
ALTER TABLE "GrantCategory" ADD CONSTRAINT "GrantCategory_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "InstructorGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrantCategory" ADD CONSTRAINT "GrantCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamTag" ADD CONSTRAINT "ExamTag_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamTag" ADD CONSTRAINT "ExamTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

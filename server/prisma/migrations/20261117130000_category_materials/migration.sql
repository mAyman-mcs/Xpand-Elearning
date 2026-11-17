-- docs/FIXES_PLAN.md fix 2: a material belongs to an exam or to a category (every exam in it).
ALTER TABLE "Material" ALTER COLUMN "examId" DROP NOT NULL;
ALTER TABLE "Material" ADD COLUMN "categoryId" UUID;

CREATE INDEX "Material_categoryId_idx" ON "Material"("categoryId");

ALTER TABLE "Material" ADD CONSTRAINT "Material_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner: an exam or a category.
ALTER TABLE "Material" ADD CONSTRAINT "Material_one_owner"
  CHECK (("examId" IS NULL) <> ("categoryId" IS NULL));

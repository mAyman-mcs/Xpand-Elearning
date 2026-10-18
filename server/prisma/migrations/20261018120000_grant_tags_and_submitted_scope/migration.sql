-- AlterTable
ALTER TABLE "InstructorGrant" ADD COLUMN     "studentsWhoSubmitted" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GrantTag" (
    "grantId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "GrantTag_pkey" PRIMARY KEY ("grantId","tagId")
);

-- CreateIndex
CREATE INDEX "GrantTag_tagId_idx" ON "GrantTag"("tagId");

-- AddForeignKey
ALTER TABLE "GrantTag" ADD CONSTRAINT "GrantTag_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "InstructorGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrantTag" ADD CONSTRAINT "GrantTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: a grant's student scope is exactly one of all groups / listed groups / students who
-- submitted (listed groups are rows in GrantGroup; the app refuses mixing them with the flags).
ALTER TABLE "InstructorGrant" ADD CONSTRAINT "InstructorGrant_student_scope"
  CHECK (NOT ("allGroups" AND "studentsWhoSubmitted"));

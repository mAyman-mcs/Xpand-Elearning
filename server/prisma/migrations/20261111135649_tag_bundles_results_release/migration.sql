-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "tagAssignmentId" UUID;

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "resultsReleasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TagAssignment" (
    "id" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "mode" "ScheduleMode" NOT NULL DEFAULT 'MANUAL',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "offsetDays" INTEGER,
    "openTime" TEXT,
    "windowMinutes" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TagAssignment_groupId_idx" ON "TagAssignment"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "TagAssignment_tagId_groupId_key" ON "TagAssignment"("tagId", "groupId");

-- CreateIndex
CREATE INDEX "Assignment_tagAssignmentId_idx" ON "Assignment"("tagAssignmentId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_tagAssignmentId_fkey" FOREIGN KEY ("tagAssignmentId") REFERENCES "TagAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagAssignment" ADD CONSTRAINT "TagAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exams already released keep a release time.
UPDATE "Exam" SET "resultsReleasedAt" = "updatedAt" WHERE "resultsReleased";

-- An exam can be assigned to the same user or group only once.
-- DropIndex
DROP INDEX "Assignment_examId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_examId_userId_key" ON "Assignment"("examId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_examId_groupId_key" ON "Assignment"("examId", "groupId");


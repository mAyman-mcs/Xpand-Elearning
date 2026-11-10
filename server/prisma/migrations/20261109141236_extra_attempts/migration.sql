-- CreateTable
CREATE TABLE "ExtraAttempt" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtraAttempt_examId_userId_idx" ON "ExtraAttempt"("examId", "userId");

-- AddForeignKey
ALTER TABLE "ExtraAttempt" ADD CONSTRAINT "ExtraAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraAttempt" ADD CONSTRAINT "ExtraAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

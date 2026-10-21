-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "furthestIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sessionId" UUID,
ADD COLUMN     "strikeMergedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Violation" ADD COLUMN     "clientTime" TIMESTAMP(3),
ADD COLUMN     "ip" TEXT;


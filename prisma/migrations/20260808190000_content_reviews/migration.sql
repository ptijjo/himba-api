-- CreateEnum
CREATE TYPE "ContentReviewOutcome" AS ENUM ('OK', 'WARNING', 'CONTENT_REMOVED', 'RESTRICTED', 'BANNED');

-- CreateEnum
CREATE TYPE "ContentReviewTargetType" AS ENUM ('TRACK', 'ALBUM');

-- CreateTable
CREATE TABLE "content_reviews" (
    "id" TEXT NOT NULL,
    "targetType" "ContentReviewTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "outcome" "ContentReviewOutcome" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_reviews_targetType_targetId_createdAt_idx" ON "content_reviews"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "content_reviews_outcome_createdAt_idx" ON "content_reviews"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "content_reviews_createdAt_idx" ON "content_reviews"("createdAt");

-- CreateIndex
CREATE INDEX "content_reviews_reviewerId_createdAt_idx" ON "content_reviews"("reviewerId", "createdAt");

-- AddForeignKey
ALTER TABLE "content_reviews" ADD CONSTRAINT "content_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN "albumId" TEXT;

-- CreateIndex
CREATE INDEX "ratings_albumId_idx" ON "ratings"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_userId_albumId_key" ON "ratings"("userId", "albumId");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

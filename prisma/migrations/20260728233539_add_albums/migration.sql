-- AlterTable
ALTER TABLE "tracks" ADD COLUMN     "albumId" TEXT,
ADD COLUMN     "albumPosition" INTEGER;

-- CreateTable
CREATE TABLE "albums" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "albums_artistId_idx" ON "albums"("artistId");

-- CreateIndex
CREATE INDEX "albums_createdAt_idx" ON "albums"("createdAt");

-- CreateIndex
CREATE INDEX "tracks_albumId_albumPosition_idx" ON "tracks"("albumId", "albumPosition");

-- AddForeignKey
ALTER TABLE "albums" ADD CONSTRAINT "albums_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

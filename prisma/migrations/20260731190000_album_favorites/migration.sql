-- CreateTable
CREATE TABLE "album_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "album_favorites_albumId_idx" ON "album_favorites"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "album_favorites_userId_albumId_key" ON "album_favorites"("userId", "albumId");

-- AddForeignKey
ALTER TABLE "album_favorites" ADD CONSTRAINT "album_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_favorites" ADD CONSTRAINT "album_favorites_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

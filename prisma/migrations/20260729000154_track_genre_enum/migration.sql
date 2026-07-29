/*
  Warnings:

  - Changed the type of `genre` on the `tracks` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "TrackGenre" AS ENUM ('RAP', 'AFRO', 'ZOUK', 'SHATTA', 'COUPE_DECALE', 'DANCEHALL', 'RNB', 'POP', 'GOSPEL', 'REGGAE', 'KOMPA', 'OTHER');

-- AlterTable
ALTER TABLE "tracks" DROP COLUMN "genre",
ADD COLUMN     "genre" "TrackGenre" NOT NULL;

-- CreateIndex
CREATE INDEX "tracks_genre_idx" ON "tracks"("genre");

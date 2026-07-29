/*
  Warnings:

  - Made the column `genre` on table `tracks` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "tracks" ALTER COLUMN "genre" SET NOT NULL;

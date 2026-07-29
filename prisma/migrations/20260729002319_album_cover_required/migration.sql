/*
  Warnings:

  - Made the column `coverUrl` on table `albums` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "albums" ALTER COLUMN "coverUrl" SET NOT NULL;

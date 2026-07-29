/*
  Warnings:

  - You are about to drop the column `amountCents` on the `album_purchases` table. All the data in the column will be lost.
  - You are about to drop the column `artistAmountCents` on the `album_purchases` table. All the data in the column will be lost.
  - You are about to drop the column `priceCents` on the `albums` table. All the data in the column will be lost.
  - You are about to drop the column `amountCents` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `artistAmountCents` on the `purchases` table. All the data in the column will be lost.
  - You are about to drop the column `priceCents` on the `tracks` table. All the data in the column will be lost.
  - Added the required column `amount` to the `album_purchases` table without a default value. This is not possible if the table is not empty.
  - Added the required column `artistAmount` to the `album_purchases` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount` to the `purchases` table without a default value. This is not possible if the table is not empty.
  - Added the required column `artistAmount` to the `purchases` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "album_purchases" DROP COLUMN "amountCents",
DROP COLUMN "artistAmountCents",
ADD COLUMN     "amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "artistAmount" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "albums" DROP COLUMN "priceCents",
ADD COLUMN     "price" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "purchases" DROP COLUMN "amountCents",
DROP COLUMN "artistAmountCents",
ADD COLUMN     "amount" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "artistAmount" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "tracks" DROP COLUMN "priceCents",
ADD COLUMN     "price" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "albums" ADD COLUMN     "priceCents" INTEGER;

-- CreateTable
CREATE TABLE "album_purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "platformCommissionPercent" INTEGER NOT NULL,
    "artistAmountCents" INTEGER NOT NULL,
    "stripePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "album_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "album_purchases_stripePaymentId_key" ON "album_purchases"("stripePaymentId");

-- CreateIndex
CREATE INDEX "album_purchases_albumId_idx" ON "album_purchases"("albumId");

-- CreateIndex
CREATE UNIQUE INDEX "album_purchases_userId_albumId_key" ON "album_purchases"("userId", "albumId");

-- AddForeignKey
ALTER TABLE "album_purchases" ADD CONSTRAINT "album_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "album_purchases" ADD CONSTRAINT "album_purchases_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "albums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

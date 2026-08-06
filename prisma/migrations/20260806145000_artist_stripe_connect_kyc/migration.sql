-- CreateEnum
CREATE TYPE "ArtistKycStatus" AS ENUM ('PENDING', 'RESTRICTED', 'VERIFIED');

-- AlterTable
ALTER TABLE "artists" ADD COLUMN "stripeAccountId" TEXT,
ADD COLUMN "kycStatus" "ArtistKycStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stripeRequirementsDue" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "artists_stripeAccountId_key" ON "artists"("stripeAccountId");

-- CreateIndex
CREATE INDEX "artists_kycStatus_idx" ON "artists"("kycStatus");

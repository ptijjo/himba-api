-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "loginNormalized" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_attempts_userId_createdAt_idx" ON "login_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_loginNormalized_createdAt_idx" ON "login_attempts"("loginNormalized", "createdAt");

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

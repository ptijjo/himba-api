-- Push tokens + fil notifications (sorties artistes suivis)
CREATE TYPE "NotificationType" AS ENUM ('TRACK_RELEASE', 'ALBUM_RELEASE');

CREATE TABLE "device_push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_push_tokens_token_key" ON "device_push_tokens"("token");
CREATE INDEX "device_push_tokens_userId_idx" ON "device_push_tokens"("userId");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

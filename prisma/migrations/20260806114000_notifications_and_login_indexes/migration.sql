-- Notifications: accélère markAllRead (userId + readAt) et requêtes unread.
CREATE INDEX "notifications_userId_readAt_idx"
ON "notifications"("userId", "readAt");

-- Login attempts admin monitor: filtre success + tri createdAt.
CREATE INDEX "login_attempts_success_createdAt_idx"
ON "login_attempts"("success", "createdAt");

export type AuthSessionRecord = {
  sessionId: string;
  jti: string;
  userId: string;
  createdAt: string;
  lastActiveAt: string;
};

export type AuthTokensResponse = {
  accessToken: string;
  refreshToken: string;
};

export type AuthUserResponse = {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthLoginResponse = AuthTokensResponse & {
  user: AuthUserResponse;
  sessionId: string;
};

/** Réponse POST /auth/register — pas de tokens tant que l’email n’est pas vérifié. */
export type AuthRegisterPendingResponse = {
  message: string;
  email: string;
};

/** Métadonnées client capturées au login (audit, pas de secrets). */
export type LoginClientMeta = {
  ip?: string;
  userAgent?: string;
};

export type AuthLoginAttemptItem = {
  id: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export type AuthLoginHistoryResponse = {
  items: AuthLoginAttemptItem[];
  nextCursor: string | null;
};

/** Ligne d’audit pour le moniteur ADMIN (inclut login + userId). */
export type AdminLoginAttemptItem = AuthLoginAttemptItem & {
  userId: string | null;
  loginNormalized: string;
};

export type AdminLoginAttemptsResponse = {
  items: AdminLoginAttemptItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type AdminLoginLockItem = {
  loginNormalized: string;
  ttlSeconds: number | null;
  failCount: number | null;
};

export type AdminLoginLocksResponse = {
  items: AdminLoginLockItem[];
  /** Alias legacy (moniteur HTML). */
  locks: AdminLoginLockItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

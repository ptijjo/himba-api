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

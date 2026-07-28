import { UserRole, UserStatus } from '../../generated/prisma/client';

/** Utilisateur authentifié attaché à la requête (profil rechargé, sans passwordHash). */
export type AuthenticatedUser = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  bio: string | null;
  avatarUrl: string | null;
  sessionId?: string;
};

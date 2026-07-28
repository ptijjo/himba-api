import { CanActivate, Provider, Type } from '@nestjs/common';
import { UserRole, UserStatus } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

export const allowAllGuard: CanActivate = {
  canActivate: () => true,
};

export function overrideGuard(Guard: Type, canActivate = true): Provider {
  return {
    provide: Guard,
    useValue: { canActivate: () => canActivate },
  };
}

export function mockAuthenticatedUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    username: 'listener1',
    email: 'listener1@example.com',
    role: UserRole.LISTENER,
    status: UserStatus.ACTIVE,
    bio: null,
    avatarUrl: null,
    sessionId: 'session-1',
    ...overrides,
  };
}

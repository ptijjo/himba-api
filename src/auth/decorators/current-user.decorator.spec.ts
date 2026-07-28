import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserRole, UserStatus } from '../../generated/prisma/client';
import { extractAuthenticatedUser } from './current-user.decorator';

describe('extractAuthenticatedUser', () => {
  it('retourne user si présent', () => {
    const user = {
      id: 'u1',
      username: 'alice',
      email: 'a@b.c',
      role: UserRole.LISTENER,
      status: UserStatus.ACTIVE,
      bio: null,
      avatarUrl: null,
      sessionId: 's1',
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;

    expect(extractAuthenticatedUser(ctx)).toEqual(user);
  });

  it('401 si absent', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    expect(() => extractAuthenticatedUser(ctx)).toThrow(UnauthorizedException);
  });
});

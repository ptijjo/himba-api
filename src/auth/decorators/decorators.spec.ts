import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
import { mockAuthenticatedUser } from '../../test/mocks/guards.mock';
import { extractAuthenticatedUser } from './current-user.decorator';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';

describe('auth decorators', () => {
  it('Public / Roles exposent les clés metadata', () => {
    expect(IS_PUBLIC_KEY).toBe('isPublic');
    expect(ROLES_KEY).toBe('roles');
    expect(typeof Public()).toBe('function');
    expect(typeof Roles(UserRole.ADMIN)).toBe('function');
  });

  it('extractAuthenticatedUser retourne request.user', () => {
    const user = mockAuthenticatedUser();
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as ExecutionContext;

    expect(extractAuthenticatedUser(ctx)).toEqual(user);
  });

  it('extractAuthenticatedUser sans user → 401', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as ExecutionContext;

    expect(() => extractAuthenticatedUser(ctx)).toThrow(UnauthorizedException);
  });
});

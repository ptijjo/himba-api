import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '../../generated/prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtAuthGuardGlobal } from './jwt-auth.guard.global';
import { RolesGuard } from './roles.guard';
import { mockAuthenticatedUser } from '../../test/mocks/guards.mock';

function mockContext(user?: unknown): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuardGlobal', () => {
  let guard: JwtAuthGuardGlobal;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuardGlobal,
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();
    guard = module.get(JwtAuthGuardGlobal);
  });

  it('autorise immédiatement une route @Public', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(mockContext())).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('handleRequest sans user → 401', () => {
    expect(() => guard.handleRequest(null, false)).toThrow(
      UnauthorizedException,
    );
  });

  it('handleRequest avec user → retourne le user', () => {
    const user = mockAuthenticatedUser();
    expect(guard.handleRequest(null, user)).toBe(user);
  });
});

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [RolesGuard, { provide: Reflector, useValue: reflector }],
    }).compile();
    guard = module.get(RolesGuard);
  });

  it('laisse passer sans @Roles si user non banni', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(mockContext(mockAuthenticatedUser()))).toBe(true);
  });

  it('refuse un user BANNED', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(
        mockContext(mockAuthenticatedUser({ status: UserStatus.BANNED })),
      ),
    ).toThrow(ForbiddenException);
  });

  it('refuse un rôle insuffisant', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ROLES_KEY ? [UserRole.ADMIN] : undefined,
    );
    expect(() =>
      guard.canActivate(
        mockContext(mockAuthenticatedUser({ role: UserRole.LISTENER })),
      ),
    ).toThrow(ForbiddenException);
  });

  it('refuse si @Roles présent sans user', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ROLES_KEY ? [UserRole.ADMIN] : undefined,
    );
    expect(() => guard.canActivate(mockContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('autorise le rôle requis', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === ROLES_KEY ? [UserRole.ARTIST, UserRole.ADMIN] : undefined,
    );
    expect(
      guard.canActivate(
        mockContext(mockAuthenticatedUser({ role: UserRole.ARTIST })),
      ),
    ).toBe(true);
  });
});

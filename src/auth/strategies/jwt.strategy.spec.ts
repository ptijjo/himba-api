import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '../../generated/prisma/client';
import { UsersService } from '../../users/users.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findById: jest.Mock };

  beforeEach(async () => {
    usersService = { findById: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('test-secret'),
          },
        },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();
    strategy = module.get(JwtStrategy);
  });

  it('retourne le profil rechargé avec sessionId', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      email: 'a@b.com',
      role: UserRole.LISTENER,
      status: UserStatus.ACTIVE,
      bio: null,
      avatarUrl: null,
    });

    await expect(
      strategy.validate({ sub: 'user-1', sid: 'session-1' }),
    ).resolves.toMatchObject({
      id: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('lève UnauthorizedException si user absent', async () => {
    usersService.findById.mockResolvedValue(null);

    await expect(strategy.validate({ sub: 'missing' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('lève ForbiddenException si user BANNED', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      username: 'alice',
      email: 'a@b.com',
      role: UserRole.LISTENER,
      status: UserStatus.BANNED,
      bio: null,
      avatarUrl: null,
    });

    await expect(strategy.validate({ sub: 'user-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

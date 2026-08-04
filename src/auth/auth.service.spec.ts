import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { mockConfigServiceProvider } from '../test/mocks/config.mock';
import {
  createMockPrismaService,
  mockPrismaServiceProvider,
  MockPrismaService,
} from '../test/mocks/prisma.mock';
import {
  createMockRedisService,
  mockRedisServiceProvider,
  MockRedisService,
} from '../test/mocks/redis.mock';
import { AuthService, parseDurationToSeconds } from './auth.service';
import { AuthSessionRecord } from './types/auth-response.type';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let redis: MockRedisService;
  let jwtService: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let usersService: {
    findByLogin: jest.Mock;
    findById: jest.Mock;
  };
  let mailService: { send: jest.Mock };

  const nowIso = '2026-07-28T10:00:00.000Z';

  const baseUser = {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    passwordHash: 'hashed',
    role: UserRole.LISTENER,
    status: UserStatus.ACTIVE,
    bio: null,
    avatarUrl: null,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(nowIso));

    prisma = createMockPrismaService();
    redis = createMockRedisService();
    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };
    usersService = {
      findByLogin: jest.fn(),
      findById: jest.fn(),
    };
    mailService = { send: jest.fn().mockResolvedValue(undefined) };

    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    jwtService.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        mockPrismaServiceProvider(prisma),
        mockRedisServiceProvider(redis),
        mockConfigServiceProvider(),
        { provide: JwtService, useValue: jwtService },
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('crée un LISTENER non vérifié, envoie l’email, sans session', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: null,
      });

      const result = await service.register({
        email: 'Alice@Example.com',
        username: 'alice',
        password: 'Password1!',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('Password1!', 14);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'alice@example.com',
          username: 'alice',
          passwordHash: 'hashed-password',
          role: UserRole.LISTENER,
          emailVerifiedAt: null,
        },
      });
      expect(result).toEqual({
        message: expect.stringContaining('boîte mail'),
        email: 'alice@example.com',
      });
      expect(mailService.send).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('lève ConflictException si email déjà pris', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(baseUser)
        .mockResolvedValueOnce(null);

      await expect(
        service.register({
          email: 'alice@example.com',
          username: 'alice2',
          password: 'Password1!',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('lève ConflictException si username déjà pris', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseUser);

      await expect(
        service.register({
          email: 'new@example.com',
          username: 'alice',
          password: 'Password1!',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login email verification', () => {
    it('refuse si email non vérifié', async () => {
      usersService.findByLogin.mockResolvedValue({
        ...baseUser,
        emailVerifiedAt: null,
        createdAt: new Date(nowIso),
      });
      await expect(
        service.login({ login: 'alice', password: 'Password1!' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('login', () => {
    it('authentifie via email/password et retourne tokens + session', async () => {
      usersService.findByLogin.mockResolvedValue(baseUser);
      redis.smembers.mockResolvedValue([]);

      const result = await service.login({
        login: 'Alice@Example.com',
        password: 'Password1!',
      });

      expect(usersService.findByLogin).toHaveBeenCalledWith('Alice@Example.com');
      expect(bcrypt.compare).toHaveBeenCalledWith('Password1!', 'hashed');
      expect(result.accessToken).toBe('access-token');
      expect(result.sessionId).toBeDefined();
    });

    it('lève UnauthorizedException si identifiants invalides', async () => {
      usersService.findByLogin.mockResolvedValue(null);

      await expect(
        service.login({ login: 'unknown', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lève UnauthorizedException si mot de passe incorrect', async () => {
      usersService.findByLogin.mockResolvedValue(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ login: 'alice', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lève ForbiddenException si user BANNED', async () => {
      usersService.findByLogin.mockResolvedValue({
        ...baseUser,
        status: UserStatus.BANNED,
      });

      await expect(
        service.login({ login: 'alice', password: 'Password1!' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('révoque la session la plus ancienne quand max 3 est dépassé', async () => {
      usersService.findByLogin.mockResolvedValue(baseUser);

      const sessions: AuthSessionRecord[] = [
        {
          sessionId: 's1',
          jti: 'j1',
          userId: 'user-1',
          createdAt: '2026-07-01T00:00:00.000Z',
          lastActiveAt: '2026-07-10T00:00:00.000Z',
        },
        {
          sessionId: 's2',
          jti: 'j2',
          userId: 'user-1',
          createdAt: '2026-07-02T00:00:00.000Z',
          lastActiveAt: '2026-07-11T00:00:00.000Z',
        },
        {
          sessionId: 's3',
          jti: 'j3',
          userId: 'user-1',
          createdAt: '2026-07-03T00:00:00.000Z',
          lastActiveAt: '2026-07-12T00:00:00.000Z',
        },
      ];

      redis.smembers.mockResolvedValue(['s1', 's2', 's3']);
      redis.getJson.mockImplementation(async (key: string) => {
        if (key === 'session:user-1:s1') return sessions[0];
        if (key === 'session:user-1:s2') return sessions[1];
        if (key === 'session:user-1:s3') return sessions[2];
        return null;
      });

      await service.login({ login: 'alice', password: 'Password1!' });

      // FIFO : s1 (lastActiveAt le plus ancien) révoquée
      expect(redis.del).toHaveBeenCalledWith(
        'refresh:user-1:j1',
        'session:user-1:s1',
      );
      expect(redis.srem).toHaveBeenCalledWith('sessions:user-1', 's1');
    });
  });

  describe('refresh', () => {
    it('rotate le refresh et renvoie de nouveaux tokens', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'old-jti',
        sessionId: 'session-1',
      });
      redis.get.mockResolvedValue('session-1');
      redis.getJson.mockResolvedValue({
        sessionId: 'session-1',
        jti: 'old-jti',
        userId: 'user-1',
        createdAt: '2026-07-20T00:00:00.000Z',
        lastActiveAt: '2026-07-20T00:00:00.000Z',
      } satisfies AuthSessionRecord);
      usersService.findById.mockResolvedValue(baseUser);
      jwtService.signAsync
        .mockReset()
        .mockResolvedValueOnce('new-access')
        .mockResolvedValueOnce('new-refresh');

      const result = await service.refresh({ refreshToken: 'old-refresh' });

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');
      expect(redis.del).toHaveBeenCalledWith('refresh:user-1:old-jti');
      expect(redis.set).toHaveBeenCalled();
      expect(redis.setJson).toHaveBeenCalled();
    });

    it('lève UnauthorizedException si refresh invalide en Redis', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti',
        sessionId: 'session-1',
      });
      redis.get.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

  it('lève UnauthorizedException si le JWT refresh est invalide', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));

      await expect(
        service.refresh({ refreshToken: 'broken' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lève UnauthorizedException si la session Redis ne matche pas le jti', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti',
        sessionId: 'session-1',
      });
      redis.get.mockResolvedValue('session-1');
      redis.getJson.mockResolvedValue({
        sessionId: 'session-1',
        jti: 'other-jti',
        userId: 'user-1',
        createdAt: nowIso,
        lastActiveAt: nowIso,
      });

      await expect(
        service.refresh({ refreshToken: 'tok' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lève UnauthorizedException si user introuvable au refresh', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti',
        sessionId: 'session-1',
      });
      redis.get.mockResolvedValue('session-1');
      redis.getJson.mockResolvedValue({
        sessionId: 'session-1',
        jti: 'jti',
        userId: 'user-1',
        createdAt: nowIso,
        lastActiveAt: nowIso,
      });
      usersService.findById.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'tok' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lève ForbiddenException si user BANNED au refresh', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti',
        sessionId: 'session-1',
      });
      redis.get.mockResolvedValue('session-1');
      redis.getJson.mockResolvedValue({
        sessionId: 'session-1',
        jti: 'jti',
        userId: 'user-1',
        createdAt: nowIso,
        lastActiveAt: nowIso,
      });
      usersService.findById.mockResolvedValue({
        ...baseUser,
        status: UserStatus.BANNED,
      });

      await expect(
        service.refresh({ refreshToken: 'tok' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('forgotPassword', () => {
    it('renvoie un message neutre si compte inconnu', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@example.com');

      expect(result.message).toContain('Si un compte existe');
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('envoie un email reset si compte vérifié', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);

      const result = await service.forgotPassword(baseUser.email);

      expect(result.message).toContain('Si un compte existe');
      expect(mailService.send).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('met à jour le hash + révoque toutes les sessions', async () => {
      redis.get.mockResolvedValue(baseUser.id);
      prisma.user.findUnique.mockResolvedValue(baseUser);
      redis.smembers.mockResolvedValue(['s1', 's2']);
      redis.getJson.mockImplementation(async (key: string) => {
        if (key === 'session:user-1:s1') {
          return {
            sessionId: 's1',
            jti: 'j1',
            userId: 'user-1',
            createdAt: nowIso,
            lastActiveAt: nowIso,
          };
        }
        if (key === 'session:user-1:s2') {
          return {
            sessionId: 's2',
            jti: 'j2',
            userId: 'user-1',
            createdAt: nowIso,
            lastActiveAt: nowIso,
          };
        }
        return null;
      });
      prisma.user.update.mockResolvedValue(baseUser);

      const result = await service.resetPassword('token-reset', 'Password1!');

      expect(result.message).toContain('Mot de passe mis à jour');
      expect(bcrypt.hash).toHaveBeenCalledWith('Password1!', 14);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed-password' },
      });
      expect(redis.del).toHaveBeenCalledWith(
        'refresh:user-1:j1',
        'session:user-1:s1',
      );
      expect(redis.del).toHaveBeenCalledWith(
        'refresh:user-1:j2',
        'session:user-1:s2',
      );
    });

    it('lève BadRequestException si token expiré/invalide', async () => {
      redis.get.mockResolvedValue(null);

      await expect(
        service.resetPassword('expired-token', 'Password1!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('logout', () => {
    it('révoque uniquement la session courante', async () => {
      redis.getJson.mockResolvedValue({
        sessionId: 'session-1',
        jti: 'jti-1',
        userId: 'user-1',
        createdAt: nowIso,
        lastActiveAt: nowIso,
      });

      await service.logout('user-1', 'session-1');

      expect(redis.del).toHaveBeenCalledWith(
        'refresh:user-1:jti-1',
        'session:user-1:session-1',
      );
      expect(redis.srem).toHaveBeenCalledWith('sessions:user-1', 'session-1');
    });

    it('ne fait rien si la session est déjà absente', async () => {
      redis.getJson.mockResolvedValue(null);

      await service.logout('user-1', 'missing');

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('liste les sessions actives triées par lastActiveAt desc', async () => {
      redis.smembers.mockResolvedValue(['s1', 's2']);
      redis.getJson.mockImplementation(async (key: string) => {
        if (key === 'session:user-1:s1') {
          return {
            sessionId: 's1',
            jti: 'j1',
            userId: 'user-1',
            createdAt: '2026-07-01T00:00:00.000Z',
            lastActiveAt: '2026-07-10T00:00:00.000Z',
          };
        }
        if (key === 'session:user-1:s2') {
          return {
            sessionId: 's2',
            jti: 'j2',
            userId: 'user-1',
            createdAt: '2026-07-02T00:00:00.000Z',
            lastActiveAt: '2026-07-20T00:00:00.000Z',
          };
        }
        return null;
      });

      const sessions = await service.listSessions('user-1');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('s2');
      expect(sessions[1].sessionId).toBe('s1');
    });
  });

  describe('revokeSession', () => {
    it('révoque une session distante appartenant à l’utilisateur', async () => {
      redis.getJson.mockResolvedValue({
        sessionId: 's2',
        jti: 'j2',
        userId: 'user-1',
        createdAt: nowIso,
        lastActiveAt: nowIso,
      });

      await service.revokeSession('user-1', 's2');

      expect(redis.del).toHaveBeenCalledWith(
        'refresh:user-1:j2',
        'session:user-1:s2',
      );
    });

    it('lève UnauthorizedException si session inconnue', async () => {
      redis.getJson.mockResolvedValue(null);

      await expect(
        service.revokeSession('user-1', 'missing'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('parseDurationToSeconds', () => {
    it('parse s/m/h/d et fallback', () => {
      expect(parseDurationToSeconds('30s')).toBe(30);
      expect(parseDurationToSeconds('5m')).toBe(300);
      expect(parseDurationToSeconds('2h')).toBe(7200);
      expect(parseDurationToSeconds('7d')).toBe(604800);
      expect(parseDurationToSeconds('invalid')).toBe(604800);
    });
  });
});

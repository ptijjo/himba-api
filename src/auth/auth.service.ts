import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { User, UserRole, UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import {
  AuthLoginResponse,
  AuthSessionRecord,
  AuthTokensResponse,
  AuthUserResponse,
} from './types/auth-response.type';
import { resolveBcryptRounds } from '../common/crypto/bcrypt-rounds';

type RefreshPayload = {
  sub: string;
  jti: string;
  sessionId: string;
};

@Injectable()
export class AuthService {
  private readonly maxSessions: number;
  private readonly refreshTtlSeconds: number;
  private readonly accessSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: string;
  private readonly bcryptRounds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    this.maxSessions = Number(
      this.configService.get<string | number>('AUTH_MAX_SESSIONS', 3),
    );
    this.accessSecret = this.configService.getOrThrow<string>('JWT_SECRET');
    this.accessExpiresIn = this.configService.get<string>(
      'JWT_EXPIRES_IN',
      '1h',
    );
    this.refreshSecret =
      this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );
    this.refreshTtlSeconds = parseDurationToSeconds(this.refreshExpiresIn);
    this.bcryptRounds = resolveBcryptRounds(
      this.configService.get<string | number>('BCRYPT_ROUNDS'),
    );
  }

  async register(dto: RegisterDto): Promise<AuthLoginResponse> {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();

    // 1. Unicité email / username avant création
    const existingEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingEmail) {
      throw new ConflictException('Email déjà utilisé');
    }

    const existingUsername = await this.prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      throw new ConflictException('Nom d’utilisateur déjà utilisé');
    }

    // 2. Hash mot de passe (BCRYPT_ROUNDS, défaut 14) + création LISTENER
    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        role: UserRole.LISTENER,
      },
    });

    // 3. Session Redis + tokens
    return this.issueSessionForUser(user);
  }

  async login(dto: LoginDto): Promise<AuthLoginResponse> {
    // 1. Résoudre login (email ou pseudo)
    const user = await this.usersService.findByLogin(dto.login);
    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    // 2. Vérifier mot de passe
    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    // 3. Bloquer les comptes bannis dès le login
    this.assertNotBanned(user);

    return this.issueSessionForUser(user);
  }

  async refresh(dto: RefreshDto): Promise<AuthTokensResponse> {
    // 1. Vérifier signature refresh JWT
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(
        dto.refreshToken,
        { secret: this.refreshSecret },
      );
    } catch {
      throw new UnauthorizedException('Refresh token invalide');
    }

    // 2. Contrôle présence Redis (révocation / rotation)
    const refreshKey = this.refreshKey(payload.sub, payload.jti);
    const storedSessionId = await this.redis.get(refreshKey);
    if (!storedSessionId || storedSessionId !== payload.sessionId) {
      throw new UnauthorizedException('Refresh token révoqué ou inconnu');
    }

    const sessionKey = this.sessionKey(payload.sub, payload.sessionId);
    const session = await this.redis.getJson<AuthSessionRecord>(sessionKey);
    if (!session || session.jti !== payload.jti) {
      throw new UnauthorizedException('Session invalide');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }
    this.assertNotBanned(user);

    // 3. Rotation jti : invalider l’ancien refresh, émettre le nouveau
    await this.redis.del(refreshKey);
    const newJti = randomUUID();
    const now = new Date().toISOString();
    const updatedSession: AuthSessionRecord = {
      ...session,
      jti: newJti,
      lastActiveAt: now,
    };

    await this.redis.set(
      this.refreshKey(user.id, newJti),
      updatedSession.sessionId,
      this.refreshTtlSeconds,
    );
    await this.redis.setJson(
      sessionKey,
      updatedSession,
      this.refreshTtlSeconds,
    );

    return this.signTokens(user.id, updatedSession.sessionId, newJti);
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.revokeSessionInternal(userId, sessionId);
  }

  async listSessions(userId: string): Promise<AuthSessionRecord[]> {
    const sessionIds = await this.redis.smembers(this.sessionsIndexKey(userId));
    const sessions: AuthSessionRecord[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.redis.getJson<AuthSessionRecord>(
        this.sessionKey(userId, sessionId),
      );
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort(
      (a, b) =>
        new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
    );
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.redis.getJson<AuthSessionRecord>(
      this.sessionKey(userId, sessionId),
    );
    if (!session) {
      throw new UnauthorizedException('Session introuvable');
    }
    await this.revokeSessionInternal(userId, sessionId);
  }

  private async issueSessionForUser(user: User): Promise<AuthLoginResponse> {
    // 1. Cap sessions : FIFO sur lastActiveAt puis createdAt
    await this.enforceSessionLimit(user.id);

    const sessionId = randomUUID();
    const jti = randomUUID();
    const now = new Date().toISOString();
    const session: AuthSessionRecord = {
      sessionId,
      jti,
      userId: user.id,
      createdAt: now,
      lastActiveAt: now,
    };

    // 2. Persister refresh + session + index Redis
    await this.redis.set(
      this.refreshKey(user.id, jti),
      sessionId,
      this.refreshTtlSeconds,
    );
    await this.redis.setJson(
      this.sessionKey(user.id, sessionId),
      session,
      this.refreshTtlSeconds,
    );
    await this.redis.sadd(this.sessionsIndexKey(user.id), sessionId);

    const tokens = await this.signTokens(user.id, sessionId, jti);

    return {
      ...tokens,
      sessionId,
      user: this.toAuthUser(user),
    };
  }

  private async enforceSessionLimit(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(this.sessionsIndexKey(userId));
    if (sessionIds.length < this.maxSessions) {
      return;
    }

    const sessions: AuthSessionRecord[] = [];
    for (const sessionId of sessionIds) {
      const session = await this.redis.getJson<AuthSessionRecord>(
        this.sessionKey(userId, sessionId),
      );
      if (session) {
        sessions.push(session);
      }
    }

    sessions.sort((a, b) => {
      const byActive =
        new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime();
      if (byActive !== 0) {
        return byActive;
      }
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });

    const overflow = sessions.length - this.maxSessions + 1;
    for (let i = 0; i < overflow; i += 1) {
      const oldest = sessions[i];
      if (oldest) {
        await this.revokeSessionInternal(userId, oldest.sessionId);
      }
    }
  }

  private async revokeSessionInternal(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.redis.getJson<AuthSessionRecord>(
      this.sessionKey(userId, sessionId),
    );
    if (!session) {
      return;
    }

    await this.redis.del(
      this.refreshKey(userId, session.jti),
      this.sessionKey(userId, sessionId),
    );
    await this.redis.srem(this.sessionsIndexKey(userId), sessionId);
  }

  private async signTokens(
    userId: string,
    sessionId: string,
    jti: string,
  ): Promise<AuthTokensResponse> {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, sid: sessionId },
      {
        secret: this.accessSecret,
        expiresIn: this.accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, jti, sessionId },
      {
        secret: this.refreshSecret,
        expiresIn: this.refreshExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    return { accessToken, refreshToken };
  }

  private assertNotBanned(user: User): void {
    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('Compte banni');
    }
  }

  private toAuthUser(user: User): AuthUserResponse {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private refreshKey(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  private sessionKey(userId: string, sessionId: string): string {
    return `session:${userId}:${sessionId}`;
  }

  private sessionsIndexKey(userId: string): string {
    return `sessions:${userId}`;
  }
}

/** Convertit JWT_REFRESH_EXPIRES_IN (ex. 7d) en secondes Redis TTL. */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) {
    return 7 * 24 * 3600;
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase() as 's' | 'm' | 'h' | 'd';
  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}

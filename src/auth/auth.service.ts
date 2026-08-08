import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { parseLimit } from '../common/pagination/cursor.dto';
import {
  parsePage,
  parsePageLimit,
  pageSkip,
  toPageResult,
} from '../common/pagination/page.dto';
import { resolveBcryptRounds } from '../common/crypto/bcrypt-rounds';
import { User, UserRole, UserStatus, ArtistKycStatus } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import {
  AuthLoginHistoryResponse,
  AuthLoginResponse,
  AuthRegisterPendingResponse,
  AuthSessionRecord,
  AuthTokensResponse,
  AuthUserResponse,
  AdminLoginAttemptsResponse,
  AdminLoginLockItem,
  AdminLoginLocksResponse,
  LoginClientMeta,
} from './types/auth-response.type';

type RefreshPayload = {
  sub: string;
  jti: string;
  sessionId: string;
};

type LoginAttemptReason =
  | 'SUCCESS'
  | 'INVALID_CREDENTIALS'
  | 'LOCKED'
  | 'BANNED'
  | 'EMAIL_UNVERIFIED';

@Injectable()
export class AuthService {
  private readonly maxSessions: number;
  private readonly refreshTtlSeconds: number;
  private readonly accessSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: string;
  private readonly bcryptRounds: number;
  private readonly emailVerifyTtlSeconds: number;
  private readonly resetPasswordTtlSeconds: number;
  private readonly apiPublicUrl: string;
  private readonly loginMaxAttempts: number;
  private readonly loginLockoutTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
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
    const ttlHours = Number(
      this.configService.get<string | number>('EMAIL_VERIFY_TTL_HOURS', 48),
    );
    this.emailVerifyTtlSeconds = Math.max(1, ttlHours) * 3600;
    const resetHours = Number(
      this.configService.get<string | number>('RESET_PASSWORD_TTL_HOURS', 1),
    );
    this.resetPasswordTtlSeconds = Math.max(1, resetHours) * 3600;
    this.apiPublicUrl = (
      this.configService.get<string>('API_PUBLIC_URL') ??
      'http://localhost:8989'
    ).replace(/\/$/, '');
    this.loginMaxAttempts = Math.max(
      1,
      Number(
        this.configService.get<string | number>('AUTH_LOGIN_MAX_ATTEMPTS', 5),
      ),
    );
    this.loginLockoutTtlSec = Math.max(
      60,
      Number(
        this.configService.get<string | number>(
          'AUTH_LOGIN_LOCKOUT_TTL_SEC',
          900,
        ),
      ),
    );
  }

  /**
   * Inscription : crée le user (email non vérifié), envoie le lien Mailjet.
   * Parcours artiste → Artist KYC PENDING (rôle reste LISTENER jusqu’à Stripe Connect).
   * Pas de session / tokens tant que l’email n’est pas confirmé.
   */
  async register(dto: RegisterDto): Promise<AuthRegisterPendingResponse> {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();
    // 1. User LISTENER · 2. Si parcours artiste → Artist KYC PENDING (pas de rôle ARTIST avant Stripe)
    const wantsArtist = dto.role === UserRole.ARTIST;
    if (wantsArtist && dto.acceptArtistTerms !== true) {
      throw new BadRequestException(
        'Tu dois accepter les conditions artiste pour t’inscrire en artiste',
      );
    }

    await this.assertCanClaimIdentity(email, username);

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          username,
          passwordHash,
          role: UserRole.LISTENER,
          emailVerifiedAt: null,
        },
      });
      if (wantsArtist) {
        await tx.artist.create({
          data: {
            userId: created.id,
            displayName: username,
            kycStatus: ArtistKycStatus.PENDING,
          },
        });
      }
      return created;
    });

    await this.sendVerificationEmail(user);

    return {
      message: wantsArtist
        ? 'Inscription presque terminée — vérifie ta boîte mail (48 h), puis complète le KYC Stripe pour publier.'
        : 'Inscription presque terminée — vérifie ta boîte mail (lien valable 48 h).',
      email: user.email,
    };
  }

  async login(
    dto: LoginDto,
    meta: LoginClientMeta = {},
  ): Promise<AuthLoginResponse> {
    const loginNormalized = dto.login.trim().toLowerCase();

    // 1. Lockout Redis par identifiant (défense compte, en plus du throttle IP)
    if (await this.isLoginLocked(loginNormalized)) {
      const existing = await this.usersService.findByLogin(dto.login);
      await this.recordLoginAttempt({
        userId: existing?.id,
        loginNormalized,
        success: false,
        reason: 'LOCKED',
        meta,
      });
      const minutes = Math.ceil(this.loginLockoutTtlSec / 60);
      throw new HttpException(
        `Trop de tentatives — réessaie dans environ ${minutes} min`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Identifiants
    const user = await this.usersService.findByLogin(dto.login);
    if (!user) {
      await this.registerFailedCredentials(loginNormalized, undefined, meta);
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      await this.registerFailedCredentials(loginNormalized, user.id, meta);
      throw new UnauthorizedException('Identifiants invalides');
    }

    // 3. Ban permanent / email non vérifié (hors compteur brute-force)
    if (user.status === UserStatus.BANNED) {
      await this.recordLoginAttempt({
        userId: user.id,
        loginNormalized,
        success: false,
        reason: 'BANNED',
        meta,
      });
      throw new ForbiddenException('Compte banni');
    }

    if (!user.emailVerifiedAt) {
      await this.recordLoginAttempt({
        userId: user.id,
        loginNormalized,
        success: false,
        reason: 'EMAIL_UNVERIFIED',
        meta,
      });
      await this.assertEmailVerifiedOrCleanup(user);
    }

    // 4. Succès : reset fails/lock + audit + session
    await this.clearLoginFailures(loginNormalized);
    await this.recordLoginAttempt({
      userId: user.id,
      loginNormalized,
      success: true,
      reason: 'SUCCESS',
      meta,
    });

    return this.issueSessionForUser(user);
  }

  /**
   * Historique des tentatives du compte courant (succès + échecs).
   * Cursor = id de la dernière ligne renvoyée.
   */
  async listLoginHistory(
    userId: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<AuthLoginHistoryResponse> {
    const limit = parseLimit(query.limit);
    const rows = await this.prisma.loginAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((row) => ({
        id: row.id,
        success: row.success,
        reason: row.reason,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Moniteur ADMIN — toutes les tentatives (filtres success / login).
   */
  async listLoginAttemptsForAdmin(query: {
    page?: number;
    limit?: number;
    success?: boolean;
    login?: string;
  }): Promise<AdminLoginAttemptsResponse> {
    const page = parsePage(query.page);
    const limit = parsePageLimit(query.limit);
    const skip = pageSkip(page, limit);
    const loginFilter = query.login?.trim().toLowerCase();

    const where = {
      ...(query.success !== undefined ? { success: query.success } : {}),
      ...(loginFilter
        ? {
            loginNormalized: {
              contains: loginFilter,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.loginAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.loginAttempt.count({ where }),
    ]);

    return toPageResult(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        loginNormalized: row.loginNormalized,
        success: row.success,
        reason: row.reason,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      })),
      total,
      page,
      limit,
    );
  }

  /** Moniteur ADMIN — comptes temporairement verrouillés (Redis). */
  async listLoginLocks(query?: {
    page?: number;
    limit?: number;
  }): Promise<AdminLoginLocksResponse> {
    const keys = await this.redis.scanKeys('login:lock:*');
    const locks: AdminLoginLockItem[] = [];

    for (const key of keys) {
      const loginNormalized = key.replace(/^login:lock:/, '');
      if (!loginNormalized) {
        continue;
      }
      const ttl = await this.redis.ttl(key);
      const failRaw = await this.redis.get(this.loginFailKey(loginNormalized));
      const failCount =
        failRaw !== null && failRaw !== '' ? Number(failRaw) : null;

      locks.push({
        loginNormalized,
        ttlSeconds: ttl >= 0 ? ttl : null,
        failCount:
          failCount !== null && Number.isFinite(failCount) ? failCount : null,
      });
    }

    locks.sort((a, b) => a.loginNormalized.localeCompare(b.loginNormalized));

    const page = parsePage(query?.page);
    const limit = parsePageLimit(query?.limit);
    const skip = pageSkip(page, limit);
    const total = locks.length;
    const items = locks.slice(skip, skip + limit);
    return { ...toPageResult(items, total, page, limit), locks: items };
  }

  /** Moniteur ADMIN — lève le ban temporaire (fail + lock Redis). */
  async unlockLogin(loginRaw: string): Promise<{ message: string }> {
    const loginNormalized = loginRaw.trim().toLowerCase();
    if (!loginNormalized) {
      throw new BadRequestException('Login requis');
    }
    await this.clearLoginFailures(loginNormalized);
    return {
      message: `Compte « ${loginNormalized} » débloqué — nouvelles tentatives autorisées.`,
    };
  }

  /**
   * Confirme l’email via token (lien Mailjet). Token à usage unique, TTL 48 h.
   */
  async verifyEmail(rawToken: string): Promise<{ message: string }> {
    const token = rawToken?.trim();
    if (!token) {
      throw new BadRequestException('Lien de vérification invalide');
    }

    const userId = await this.redis.get(this.emailVerifyKey(token));
    if (!userId) {
      throw new BadRequestException(
        'Lien invalide ou expiré — réinscris-toi ou demande un nouvel email',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await this.redis.del(this.emailVerifyKey(token));
      throw new BadRequestException('Compte introuvable');
    }

    if (user.emailVerifiedAt) {
      await this.redis.del(this.emailVerifyKey(token));
      return { message: 'Email déjà vérifié — tu peux te connecter.' };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    await this.redis.del(this.emailVerifyKey(token));

    return {
      message: 'Email confirmé — ouvre Himba et connecte-toi pour continuer.',
    };
  }

  /** Renvoie un lien si le compte existe et n’est pas encore vérifié. */
  async resendVerification(
    emailRaw: string,
  ): Promise<{ message: string }> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Message neutre anti-énumération
    const okMessage =
      'Si un compte est en attente, un nouvel email a été envoyé.';

    if (!user || user.emailVerifiedAt) {
      return { message: okMessage };
    }

    if (this.isRegistrationExpired(user)) {
      await this.prisma.user.delete({ where: { id: user.id } });
      return {
        message:
          'Le délai de 48 h est dépassé — réinscris-toi pour recevoir un nouveau lien.',
      };
    }

    await this.sendVerificationEmail(user);
    return { message: okMessage };
  }

  /**
   * Mot de passe oublié : envoi un lien reset si compte existant + email vérifié.
   * Réponse neutre pour éviter l'énumération des comptes.
   */
  async forgotPassword(emailRaw: string): Promise<{ message: string }> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    const okMessage =
      'Si un compte existe, un email de réinitialisation a été envoyé.';

    if (!user || !user.emailVerifiedAt || user.status === UserStatus.BANNED) {
      return { message: okMessage };
    }

    await this.sendResetPasswordEmail(user);
    return { message: okMessage };
  }

  /**
   * Consomme un token reset (usage unique, TTL court), puis met à jour le mot de passe.
   */
  async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const token = rawToken?.trim();
    if (!token) {
      throw new BadRequestException('Lien de réinitialisation invalide');
    }

    const userId = await this.redis.get(this.resetPasswordKey(token));
    if (!userId) {
      throw new BadRequestException(
        'Lien invalide ou expiré — redemande un email de réinitialisation',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await this.redis.del(this.resetPasswordKey(token));
      throw new BadRequestException('Compte introuvable');
    }
    if (user.status === UserStatus.BANNED) {
      await this.redis.del(this.resetPasswordKey(token));
      throw new ForbiddenException('Compte banni');
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.redis.del(this.resetPasswordKey(token));
    await this.revokeAllSessions(user.id);

    return {
      message: 'Mot de passe mis à jour — reconnecte-toi dans l’application.',
    };
  }

  /**
   * Changement de mot de passe connecté.
   * 1. Vérifier l’ancien · 2. Hasher le nouveau · 3. Révoquer les autres sessions.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId?: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }
    this.assertNotBanned(user);

    const passwordOk = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!passwordOk) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent de l’actuel',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Garde la session courante ; révoque les autres appareils
    const sessionIds = await this.redis.smembers(
      this.sessionsIndexKey(userId),
    );
    for (const sessionId of sessionIds) {
      if (currentSessionId && sessionId === currentSessionId) {
        continue;
      }
      await this.revokeSession(userId, sessionId);
    }

    return { message: 'Mot de passe mis à jour.' };
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
      } else {
        // Session expirée/absente : nettoyer l’index Redis pour éviter l’accumulation.
        await this.redis.srem(this.sessionsIndexKey(userId), sessionId);
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
    await this.redis.expire(this.sessionsIndexKey(user.id), this.refreshTtlSeconds);

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
      } else {
        await this.redis.srem(this.sessionsIndexKey(userId), sessionId);
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

  /**
   * Email non vérifié : refuse le login ; si > 48 h, purge le compte (pas enregistré).
   */
  private async assertEmailVerifiedOrCleanup(user: User): Promise<void> {
    if (user.emailVerifiedAt) {
      return;
    }
    if (this.isRegistrationExpired(user)) {
      await this.prisma.user.delete({ where: { id: user.id } });
      throw new UnauthorizedException(
        'Inscription expirée (48 h) — réinscris-toi',
      );
    }
    throw new ForbiddenException(
      'Email non vérifié — consulte ta boîte mail (lien valable 48 h)',
    );
  }

  private isRegistrationExpired(user: User): boolean {
    const ageMs = Date.now() - user.createdAt.getTime();
    return ageMs > this.emailVerifyTtlSeconds * 1000;
  }

  private async assertCanClaimIdentity(
    email: string,
    username: string,
  ): Promise<void> {
    const existingEmail = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingEmail) {
      if (
        !existingEmail.emailVerifiedAt &&
        this.isRegistrationExpired(existingEmail)
      ) {
        await this.prisma.user.delete({ where: { id: existingEmail.id } });
      } else if (!existingEmail.emailVerifiedAt) {
        throw new ConflictException(
          'Email déjà utilisé — vérifie ta boîte mail ou attends l’expiration du lien (48 h)',
        );
      } else {
        throw new ConflictException('Email déjà utilisé');
      }
    }

    const existingUsername = await this.prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      if (
        !existingUsername.emailVerifiedAt &&
        this.isRegistrationExpired(existingUsername)
      ) {
        await this.prisma.user.delete({ where: { id: existingUsername.id } });
      } else {
        throw new ConflictException('Nom d’utilisateur déjà utilisé');
      }
    }
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');
    const redisKey = this.emailVerifyKey(rawToken);
    await this.redis.set(redisKey, user.id, this.emailVerifyTtlSeconds);

    const link = `${this.apiPublicUrl}/auth/verify-email?token=${rawToken}`;
    const hours = Math.round(this.emailVerifyTtlSeconds / 3600);

    await this.mailService.send({
      to: user.email,
      subject: 'Himba — confirme ton adresse email',
      text: `Bonjour ${user.username},\n\nConfirme ton email Himba en ouvrant ce lien (valable ${hours} h) :\n${link}\n\nEnsuite : ouvre l’app Himba et connecte-toi avec ton email (ou pseudo) et ton mot de passe.\n\nSi tu n’as pas créé de compte, ignore ce message.`,
      html: `<p>Bonjour <strong>${escapeHtml(user.username)}</strong>,</p>
<p>Confirme ton adresse email pour activer ton compte Himba.</p>
<p><a href="${link}">Valider mon email</a></p>
<p>Ce lien est valable <strong>${hours} heures</strong>.</p>
<p><strong>Ensuite</strong> : ouvre l’application Himba et <strong>connecte-toi</strong> (email ou pseudo + mot de passe). La validation ne te connecte pas automatiquement.</p>
<p>Si tu n’as pas créé de compte, ignore ce message.</p>`,
    });
  }

  private async sendResetPasswordEmail(user: User): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');
    const redisKey = this.resetPasswordKey(rawToken);
    await this.redis.set(redisKey, user.id, this.resetPasswordTtlSeconds);

    const link = `${this.apiPublicUrl}/auth/reset-password?token=${rawToken}`;
    const hours = Math.round(this.resetPasswordTtlSeconds / 3600);

    await this.mailService.send({
      to: user.email,
      subject: 'Himba — réinitialise ton mot de passe',
      text: `Bonjour ${user.username},\n\nTu as demandé la réinitialisation de ton mot de passe Himba.\n\nOuvre ce lien (valable ${hours} h) :\n${link}\n\nSi tu n’es pas à l’origine de cette demande, ignore ce message.`,
      html: `<p>Bonjour <strong>${escapeHtml(user.username)}</strong>,</p>
<p>Tu as demandé la réinitialisation de ton mot de passe Himba.</p>
<p><a href="${link}">Choisir un nouveau mot de passe</a></p>
<p>Ce lien est valable <strong>${hours} heure(s)</strong>.</p>
<p>Si tu n’es pas à l’origine de cette demande, ignore ce message.</p>`,
    });
  }

  private emailVerifyKey(rawToken: string): string {
    // Hash du token en clé Redis — fuite DB Redis ≠ token brut réutilisable facilement
    const digest = createHash('sha256').update(rawToken).digest('hex');
    return `email-verify:${digest}`;
  }

  private resetPasswordKey(rawToken: string): string {
    const digest = createHash('sha256').update(rawToken).digest('hex');
    return `password-reset:${digest}`;
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    const sessionIds = await this.redis.smembers(this.sessionsIndexKey(userId));
    for (const sessionId of sessionIds) {
      await this.revokeSessionInternal(userId, sessionId);
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

  private loginFailKey(loginNormalized: string): string {
    return `login:fail:${loginNormalized}`;
  }

  private loginLockKey(loginNormalized: string): string {
    return `login:lock:${loginNormalized}`;
  }

  private async isLoginLocked(loginNormalized: string): Promise<boolean> {
    const locked = await this.redis.get(this.loginLockKey(loginNormalized));
    return locked !== null;
  }

  private async clearLoginFailures(loginNormalized: string): Promise<void> {
    await this.redis.del(
      this.loginFailKey(loginNormalized),
      this.loginLockKey(loginNormalized),
    );
  }

  /**
   * Incrémente le compteur d’échecs ; pose le lock si seuil atteint.
   * TTL sur le compteur = fenêtre lockout (échecs anciens expirent).
   */
  private async registerFailedCredentials(
    loginNormalized: string,
    userId: string | undefined,
    meta: LoginClientMeta,
  ): Promise<void> {
    const failKey = this.loginFailKey(loginNormalized);
    const fails = await this.redis.incr(failKey);
    if (fails === 1) {
      await this.redis.expire(failKey, this.loginLockoutTtlSec);
    }
    if (fails >= this.loginMaxAttempts) {
      await this.redis.set(
        this.loginLockKey(loginNormalized),
        '1',
        this.loginLockoutTtlSec,
      );
    }
    await this.recordLoginAttempt({
      userId,
      loginNormalized,
      success: false,
      reason: 'INVALID_CREDENTIALS',
      meta,
    });
  }

  private async recordLoginAttempt(input: {
    userId?: string;
    loginNormalized: string;
    success: boolean;
    reason: LoginAttemptReason;
    meta: LoginClientMeta;
  }): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        userId: input.userId,
        loginNormalized: input.loginNormalized,
        success: input.success,
        reason: input.reason,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
      },
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

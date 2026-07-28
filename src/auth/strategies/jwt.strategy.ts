import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '../../generated/prisma/client';
import { UsersService } from '../../users/users.service';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

type AccessTokenPayload = {
  sub: string;
  /** Session courante — pour logout / révocation sans recharger le profil. */
  sid?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Payload access minimal (`sub` + `sid`) — profil rechargé en base à chaque requête.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    // 1. Charger le user frais (rôle, statut sanction, avatar…)
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    // 2. Banni → 403 sur routes protégées
    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('Compte banni');
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      sessionId: payload.sid,
    };
  }
}

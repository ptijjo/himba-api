import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guard JWT global : routes @Public() bypass ; sinon Bearer obligatoire (401).
 */
@Injectable()
export class JwtAuthGuardGlobal extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // 1. Routes publiques (auth, health, webhook) — pas de Bearer
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: Error | null, user: TUser | false): TUser {
    // 2. Sans token / invalide → 401 (pas 403)
    if (err || !user) {
      throw err ?? new UnauthorizedException('Authentification requise');
    }
    return user;
  }
}

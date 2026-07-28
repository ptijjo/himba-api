import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole, UserStatus } from '../../generated/prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

type RequestWithUser = Request & { user?: AuthenticatedUser };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // 1. Compte banni → 403 même si rôle OK
    if (user?.status === UserStatus.BANNED) {
      throw new ForbiddenException('Compte banni');
    }

    // 2. Pas de @Roles → tout user authentifié OK
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    if (!user) {
      throw new ForbiddenException('Accès refusé');
    }

    // 3. Rôle insuffisant → 403
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Rôle insuffisant');
    }

    return true;
  }
}

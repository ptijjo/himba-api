import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

type RequestWithUser = Request & { user?: AuthenticatedUser };

/** Extrait l’utilisateur authentifié de la requête HTTP. */
export function extractAuthenticatedUser(
  ctx: ExecutionContext,
): AuthenticatedUser {
  const request = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!request.user) {
    throw new UnauthorizedException('Utilisateur non authentifié');
  }
  return request.user;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    extractAuthenticatedUser(ctx),
);

import { IsEnum, IsOptional } from 'class-validator';
import { UserRole, UserStatus } from '../../generated/prisma/client';

/** Body PATCH /moderation/users/:id — ADMIN. */
export class AdminUpdateUserDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** LISTENER | ARTIST uniquement — jamais ADMIN via l’UI. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

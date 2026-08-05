import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsEnum,
  IsIn,
  IsStrongPassword,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '../../generated/prisma/client';

/** Rôles autorisés à l’inscription publique (pas ADMIN). */
export const REGISTER_ROLES = [UserRole.LISTENER, UserRole.ARTIST] as const;
export type RegisterRole = (typeof REGISTER_ROLES)[number];

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username: lettres, chiffres et underscore uniquement',
  })
  username!: string;

  /**
   * Mot de passe fort : ≥ 8 car., majuscule, minuscule, chiffre, symbole.
   */
  @IsString()
  @MaxLength(72)
  @IsStrongPassword(
    {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1,
    },
    {
      message:
        'password: au moins 8 caractères, une majuscule, une minuscule, un chiffre et un symbole',
    },
  )
  password!: string;

  /** LISTENER (auditeur / autre) ou ARTIST — jamais ADMIN ici. */
  @IsEnum(UserRole)
  @IsIn(REGISTER_ROLES, {
    message: 'role: LISTENER ou ARTIST uniquement',
  })
  role!: RegisterRole;

  /**
   * Obligatoire si role = ARTIST (CGU artiste).
   * Transform : JSON boolean ou string multipart.
   */
  @ValidateIf((o: RegisterDto) => o.role === UserRole.ARTIST)
  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === '0') {
      return false;
    }
    return value;
  })
  @Equals(true, {
    message: 'Tu dois accepter les conditions artiste',
  })
  acceptArtistTerms?: boolean;
}

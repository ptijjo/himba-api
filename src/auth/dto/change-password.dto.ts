import { IsString, IsStrongPassword, MaxLength, MinLength } from 'class-validator';

/**
 * Changement de mot de passe authentifié (Bearer) — ancien + nouveau.
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

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
        'newPassword: au moins 8 caractères, une majuscule, une minuscule, un chiffre et un symbole',
    },
  )
  newPassword!: string;
}

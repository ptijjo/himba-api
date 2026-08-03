import { IsStrongPassword, IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
   * Aligné @IsStrongPassword (class-validator).
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
}

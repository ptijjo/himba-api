import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  /** Email ou pseudo. */
  @IsString()
  @MinLength(1)
  login!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

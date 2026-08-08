import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Query GET /moderation/login-attempts — ADMIN. */
export class AdminLoginAttemptsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 15;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  success?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  login?: string;
}

/** Query GET /moderation/login-locks — ADMIN. */
export class AdminLoginLocksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 15;
}

/** Body POST /moderation/login-unlock — ADMIN. */
export class UnlockLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  login!: string;
}

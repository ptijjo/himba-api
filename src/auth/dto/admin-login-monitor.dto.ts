import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CursorPaginationQueryDto } from '../../common/pagination/cursor.dto';

/** Query GET /moderation/login-attempts — ADMIN. */
export class AdminLoginAttemptsQueryDto extends CursorPaginationQueryDto {
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

/** Body POST /moderation/login-unlock — ADMIN. */
export class UnlockLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  login!: string;
}

import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { TrackGenre } from '../../generated/prisma/client';

function emptyToUndefined({ value }: { value: unknown }): unknown {
  if (value === '' || value === undefined) {
    return undefined;
  }
  if (value === 'null' || value === null) {
    return null;
  }
  return value;
}

export class UpdateTrackDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsEnum(TrackGenre, {
    message: `genre doit être l’un de : ${Object.values(TrackGenre).join(', ')}`,
  })
  genre?: TrackGenre;

  @IsOptional()
  @Transform(emptyToUndefined)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price?: number | null;

  @IsOptional()
  @Transform(emptyToUndefined)
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  durationMs?: number;
}

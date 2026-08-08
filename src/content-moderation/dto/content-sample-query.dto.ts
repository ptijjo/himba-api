import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ContentSampleQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number = 10;

  /** Fenêtre de création des titres candidats (jours). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;

  @IsOptional()
  @IsIn(['all', 'paid', 'free'])
  pricing?: 'all' | 'paid' | 'free' = 'all';
}

export class CoverSampleQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit?: number = 12;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;

  @IsOptional()
  @IsIn(['all', 'track', 'album'])
  kind?: 'all' | 'track' | 'album' = 'all';
}

/** Catalogue paginé titres (contrôles). */
export class ContentCatalogQueryDto {
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
  @IsIn(['all', 'paid', 'free'])
  pricing?: 'all' | 'paid' | 'free' = 'all';
}

/** Catalogue paginé covers. */
export class CoverCatalogQueryDto {
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
  @IsIn(['all', 'track', 'album'])
  kind?: 'all' | 'track' | 'album' = 'all';
}

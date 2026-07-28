import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CursorPaginationQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export function parseLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return 20;
  }
  return Math.min(Math.max(limit, 1), 50);
}

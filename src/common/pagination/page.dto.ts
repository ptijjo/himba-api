import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Pagination offset — back-office (15 / page par défaut). */
export class PagePaginationQueryDto {
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

export type PageResult<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function parsePage(page?: number): number {
  if (page === undefined || Number.isNaN(page)) {
    return 1;
  }
  return Math.max(1, Math.floor(page));
}

export function parsePageLimit(limit?: number, fallback = 15): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 50);
}

export function toPageResult<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PageResult<T> {
  const safeTotal = Math.max(0, total);
  const totalPages = Math.max(1, Math.ceil(safeTotal / limit) || 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  return {
    items,
    page: safePage,
    limit,
    total: safeTotal,
    totalPages,
  };
}

export function pageSkip(page: number, limit: number): number {
  return (Math.max(1, page) - 1) * limit;
}

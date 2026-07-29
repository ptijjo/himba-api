import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/** Alias pratique — Decimal Prisma (pas de float JS). */
export type Money = Prisma.Decimal;

export function money(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Stripe exige des centimes entiers. */
export function toStripeCents(value: string | number | Prisma.Decimal): number {
  return money(value)
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

export function assertMoneyInRange(
  value: number | null | undefined,
  min: Prisma.Decimal,
  max: Prisma.Decimal,
): void {
  if (value === null || value === undefined) {
    return;
  }
  const amount = money(value);
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2) {
    throw new BadRequestException(
      'Prix invalide (max 2 décimales, strictement positif)',
    );
  }
  if (amount.lt(min) || amount.gt(max)) {
    throw new BadRequestException(
      `Prix hors fourchette [${min.toFixed(2)}, ${max.toFixed(2)}] €`,
    );
  }
}

export function computeArtistShare(
  amount: Prisma.Decimal,
  commissionPercent: number,
): { platformCommissionPercent: number; artistAmount: Prisma.Decimal } {
  const platformShare = amount
    .mul(commissionPercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    platformCommissionPercent: commissionPercent,
    artistAmount: amount.minus(platformShare),
  };
}

import { money, toStripeCents, computeArtistShare, assertMoneyInRange } from './money';
import { Prisma } from '../../generated/prisma/client';

describe('money', () => {
  it('toStripeCents arrondit en centimes', () => {
    expect(toStripeCents('1.99')).toBe(199);
    expect(toStripeCents(9.999)).toBe(1000);
  });

  it('computeArtistShare applique la commission', () => {
    expect(computeArtistShare(money(10), 10)).toEqual({
      platformCommissionPercent: 10,
      artistAmount: money(9),
    });
  });

  it('assertMoneyInRange refuse hors bornes', () => {
    const min = money('0.99');
    const max = money('99.99');
    expect(() => assertMoneyInRange(0.5, min, max)).toThrow();
    expect(() => assertMoneyInRange(1.999, min, max)).toThrow();
    expect(() => assertMoneyInRange(1.99, min, max)).not.toThrow();
  });
});

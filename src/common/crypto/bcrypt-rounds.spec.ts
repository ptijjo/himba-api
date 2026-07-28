import { resolveBcryptRounds } from './bcrypt-rounds';

describe('resolveBcryptRounds', () => {
  it('retourne 14 par défaut', () => {
    expect(resolveBcryptRounds(undefined)).toBe(14);
  });

  it('accepte une valeur .env valide', () => {
    expect(resolveBcryptRounds('14')).toBe(14);
    expect(resolveBcryptRounds(12)).toBe(12);
  });

  it('fallback si hors bornes ou invalide', () => {
    expect(resolveBcryptRounds('9')).toBe(14);
    expect(resolveBcryptRounds('16')).toBe(14);
    expect(resolveBcryptRounds('abc')).toBe(14);
  });
});

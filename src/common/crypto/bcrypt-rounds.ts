/** Coût bcrypt depuis `.env` — défaut 14 (pas de constante magique ailleurs). */
export function resolveBcryptRounds(
  raw: string | number | undefined,
  fallback = 14,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 15) {
    return fallback;
  }
  return parsed;
}

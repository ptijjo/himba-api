import type { HelmetOptions } from 'helmet';

export type SecurityEnv = {
  NODE_ENV?: string;
  JWT_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  CORS_ORIGINS?: string;
};

/**
 * Refuse de démarrer en production avec des secrets faibles / placeholders.
 * Bootstrap uniquement — throw Error documenté (pas d’exception Nest).
 */
export function assertProductionSecrets(env: SecurityEnv): void {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'production') {
    return;
  }

  const weak = new Set(['', 'secret', 'changeme', 'password', 'jwt_secret']);

  const access = env.JWT_SECRET?.trim() ?? '';
  const refresh = env.JWT_REFRESH_SECRET?.trim() ?? '';

  if (access.length < 32 || weak.has(access.toLowerCase())) {
    throw new Error(
      'Sécurité: JWT_SECRET trop faible en production (min 32 caractères, pas de placeholder).',
    );
  }

  if (refresh.length < 32 || weak.has(refresh.toLowerCase())) {
    throw new Error(
      'Sécurité: JWT_REFRESH_SECRET trop faible en production (min 32 caractères, pas de placeholder).',
    );
  }

  if (access === refresh) {
    throw new Error(
      'Sécurité: JWT_SECRET et JWT_REFRESH_SECRET doivent être distincts en production.',
    );
  }

  const origins = parseCorsOrigins(env.CORS_ORIGINS);
  if (origins.length === 0) {
    throw new Error(
      'Sécurité: CORS_ORIGINS obligatoire en production (liste explicite, pas de *).',
    );
  }

  if (origins.includes('*')) {
    throw new Error(
      'Sécurité: CORS origin "*" interdit en production.',
    );
  }
}

export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Options Helmet adaptées API JSON (+ Swagger hors prod). */
export function buildHelmetOptions(nodeEnv: string): HelmetOptions {
  const isProd = nodeEnv === 'production';

  return {
    // CSP : défaut Helmet en prod ; assouplie hors prod pour /docs Swagger
    contentSecurityPolicy: isProd
      ? undefined
      : {
          useDefaults: true,
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
            connectSrc: ["'self'"],
          },
        },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    noSniff: true,
    hsts: isProd
      ? { maxAge: 15552000, includeSubDomains: true, preload: false }
      : false,
  };
}

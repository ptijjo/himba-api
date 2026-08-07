import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const defaultConfig: Record<string, string | number> = {
  JWT_SECRET: 'test-access-secret',
  JWT_EXPIRES_IN: '1h',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  JWT_REFRESH_EXPIRES_IN: '7d',
  AUTH_MAX_SESSIONS: 3,
  AUTH_LOGIN_MAX_ATTEMPTS: 5,
  AUTH_LOGIN_LOCKOUT_TTL_SEC: 900,
  BCRYPT_ROUNDS: 14,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/himba_test',
  REDIS_HOST: 'localhost',
  REDIS_PORT: 6381,
  REDIS_PASSWORD: 'mot_de_passe_secure',
  REDIS_USERNAME: 'default',
  CLOUDFLARE_R2_BUCKET_NAME: 'himba',
  CLOUDFLARE_R2_PUBLIC_BASE_URL: 'https://cdn.himba.test',
  SIGNED_URL_TTL_SECONDS: 300,
  TRACK_PRICE_MIN: 0.5,
  TRACK_PRICE_MAX: 99.99,
  PLATFORM_COMMISSION_PERCENT: 0,
  ALBUM_TRACKS_MAX: 100,
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_CONNECT_RETURN_URL: 'https://himba.cellulenoire.fr/artists/stripe/return',
  STRIPE_CONNECT_REFRESH_URL: 'https://himba.cellulenoire.fr/artists/stripe/refresh',
  MJ_APIKEY_PUBLIC: 'mj_pub',
  MJ_APIKEY_PRIVATE: 'mj_priv',
  MAILJET_SENDER_EMAIL: 'noreply@himba.test',
  MAILJET_SENDER_NAME: 'Himba',
  API_PUBLIC_URL: 'https://himba.cellulenoire.fr',
  EMAIL_VERIFY_TTL_HOURS: 48,
  NODE_ENV: 'test',
};

export function mockConfigServiceProvider(
  overrides: Record<string, string | number> = {},
): Provider {
  const values = { ...defaultConfig, ...overrides };
  return {
    provide: ConfigService,
    useValue: {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key in values) {
          return values[key];
        }
        return defaultValue;
      }),
      getOrThrow: jest.fn((key: string) => {
        if (!(key in values)) {
          throw new Error(`Missing config: ${key}`);
        }
        return values[key];
      }),
    },
  };
}

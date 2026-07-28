import {
  assertProductionSecrets,
  buildHelmetOptions,
  parseCorsOrigins,
} from './security-config';

describe('assertProductionSecrets', () => {
  it('ne bloque pas hors production', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'development',
        JWT_SECRET: 'secret',
        JWT_REFRESH_SECRET: 'secret',
      }),
    ).not.toThrow();
  });

  it('refuse JWT_SECRET placeholder en production', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'secret',
        JWT_REFRESH_SECRET: 'a'.repeat(32),
        CORS_ORIGINS: 'https://app.himba.com',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('refuse secrets trop courts en production', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'short-but-not-placeholder',
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        CORS_ORIGINS: 'https://app.himba.com',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('refuse access === refresh en production', () => {
    const same = 'c'.repeat(32);
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: same,
        JWT_REFRESH_SECRET: same,
        CORS_ORIGINS: 'https://app.himba.com',
      }),
    ).toThrow(/distincts/);
  });

  it('refuse CORS_* vide ou * en production', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        CORS_ORIGINS: '',
      }),
    ).toThrow(/CORS_ORIGINS/);

    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        CORS_ORIGINS: '*',
      }),
    ).toThrow(/\*/);
  });

  it('accepte une config production valide', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        CORS_ORIGINS: 'https://app.himba.com',
      }),
    ).not.toThrow();
  });
});

describe('parseCorsOrigins', () => {
  it('parse une liste CSV', () => {
    expect(parseCorsOrigins(' http://a.com , https://b.com ')).toEqual([
      'http://a.com',
      'https://b.com',
    ]);
  });
});

describe('buildHelmetOptions', () => {
  it('active HSTS en production', () => {
    const opts = buildHelmetOptions('production');
    expect(opts.hsts).toEqual(
      expect.objectContaining({ maxAge: 15552000 }),
    );
  });

  it('désactive HSTS hors production et assouplit CSP pour Swagger', () => {
    const opts = buildHelmetOptions('development');
    expect(opts.hsts).toBe(false);
    expect(opts.contentSecurityPolicy).toBeDefined();
  });
});

import { parseAllowedOrigins, validateEnvironment } from './environment.js';

const baseEnvironment = {
  NODE_ENV: 'development',
  PORT: '3000',
  APP_BASE_URL: 'http://localhost:3000',
  WEB_BASE_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://app:password@localhost:5432/qualyra',
  MIGRATION_DATABASE_URL: 'postgresql://owner:password@localhost:5432/qualyra',
  SHADOW_DATABASE_URL:
    'postgresql://owner:password@localhost:5432/qualyra_shadow',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_PRIVATE_KEY: 'private-key',
  JWT_ACCESS_PUBLIC_KEY: 'public-key',
  JWT_ISSUER: 'qualyra',
  JWT_AUDIENCE: 'qualyra-web',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: '30',
  PASSWORD_RESET_TTL_MINUTES: '30',
  INVITATION_TTL_HOURS: '72',
  EMAIL_VERIFICATION_TTL_HOURS: '24',
  COOKIE_SECURE: 'false',
  COOKIE_NAME: 'qualyra_refresh',
  CSRF_COOKIE_NAME: 'qualyra_csrf',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Qualyra <no-reply@qualyra.test>',
  SMTP_REQUIRE_TLS: 'false',
  ALLOW_PUBLIC_TENANT_REGISTRATION: 'true',
  TRUST_PROXY: 'false',
  REQUEST_BODY_LIMIT: '1mb',
} satisfies Record<string, string>;

describe('environment configuration', () => {
  it('accepts local development defaults', () => {
    expect(validateEnvironment(baseEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      COOKIE_SECURE: false,
      SMTP_REQUIRE_TLS: false,
    });
  });

  it('accepts a hardened production configuration', () => {
    expect(
      validateEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://api.qualyra.example',
        WEB_BASE_URL: 'https://app.qualyra.example',
        CORS_ALLOWED_ORIGINS: 'https://app.qualyra.example',
        COOKIE_SECURE: 'true',
        COOKIE_NAME: '__Host-qualyra_refresh',
        CSRF_COOKIE_NAME: '__Host-qualyra_csrf',
        SMTP_REQUIRE_TLS: 'true',
        CAPA_EVIDENCE_STORAGE_DRIVER: 's3',
        CAPA_EVIDENCE_SCANNER: 'clamav',
        CAPA_EVIDENCE_S3_ENDPOINT: 'https://evidence.qualyra.example',
      }),
    ).toMatchObject({ NODE_ENV: 'production', COOKIE_SECURE: true });
  });

  it('rejects insecure production URLs, cookies, and SMTP transport', () => {
    expect(() =>
      validateEnvironment({ ...baseEnvironment, NODE_ENV: 'production' }),
    ).toThrow(
      /APP_BASE_URL|WEB_BASE_URL|COOKIE_SECURE|COOKIE_NAME|CSRF_COOKIE_NAME|CORS_ALLOWED_ORIGINS|SMTP_REQUIRE_TLS|CAPA_EVIDENCE_STORAGE_DRIVER|CAPA_EVIDENCE_SCANNER|CAPA_EVIDENCE_S3_ENDPOINT/,
    );
  });

  it('normalizes and deduplicates exact CORS origins', () => {
    expect(
      parseAllowedOrigins(
        'https://app.qualyra.example, https://app.qualyra.example',
      ),
    ).toEqual(['https://app.qualyra.example']);
  });
});

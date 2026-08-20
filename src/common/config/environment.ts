import { z } from 'zod';

const booleanValue = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return value;
}, z.boolean());

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    APP_BASE_URL: z.url(),
    WEB_BASE_URL: z.url(),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    MIGRATION_DATABASE_URL: z.string().startsWith('postgresql://'),
    SHADOW_DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(30_000)
      .default(3_000),
    REDIS_OPERATION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(10_000)
      .default(1_000),
    JWT_ACCESS_PRIVATE_KEY: z.string().min(1),
    JWT_ACCESS_PUBLIC_KEY: z.string().min(1),
    JWT_ISSUER: z.string().min(1).max(200),
    JWT_AUDIENCE: z.string().min(1).max(200),
    JWT_ACCESS_TTL: z.string().regex(/^\d+[smhd]$/),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440),
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(720),
    COOKIE_SECURE: booleanValue,
    COOKIE_NAME: z.string().min(1).max(100),
    CSRF_COOKIE_NAME: z.string().min(1).max(100).default('qualyra_csrf'),
    CORS_ALLOWED_ORIGINS: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_REQUIRE_TLS: booleanValue.default(false),
    SMTP_FROM: z.string().min(3).max(320),
    ALLOW_PUBLIC_TENANT_REGISTRATION: booleanValue,
    PLATFORM_ADMIN_ENABLED: booleanValue.default(false),
    PLATFORM_ADMIN_BEARER_TOKEN: z
      .string()
      .min(32)
      .max(500)
      .default('qualyra_local_platform_admin_token'),
    PLATFORM_OPERATOR_ID: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,99}$/)
      .default('local-operator'),
    TRUST_PROXY: z.string().default('false'),
    REQUEST_BODY_LIMIT: z
      .string()
      .regex(/^\d+(kb|mb)$/i)
      .default('1mb'),
    OPERATIONAL_READINESS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(30_000)
      .default(5_000),
    METRICS_ENABLED: booleanValue.default(true),
    METRICS_BEARER_TOKEN: z
      .string()
      .min(24)
      .max(500)
      .default('qualyra_local_metrics_token'),
    CAPA_EVIDENCE_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    CAPA_EVIDENCE_STORAGE_ROOT: z
      .string()
      .min(1)
      .max(500)
      .default('./.local/evidence'),
    CAPA_EVIDENCE_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(26_214_400)
      .default(10_485_760),
    PHOTO_EVIDENCE_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(26_214_400)
      .default(10_485_760),
    PHOTO_EVIDENCE_TENANT_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(10_995_116_277_760)
      .default(2_147_483_648),
    PHOTO_EVIDENCE_STARTER_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(10_995_116_277_760)
      .default(10_737_418_240),
    PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(10_995_116_277_760)
      .default(53_687_091_200),
    PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .min(1_048_576)
      .max(10_995_116_277_760)
      .default(214_748_364_800),
    PHOTO_EVIDENCE_CAPACITY_WARNING_PERCENT: z.coerce
      .number()
      .int()
      .min(1)
      .max(98)
      .default(80),
    PHOTO_EVIDENCE_CAPACITY_CRITICAL_PERCENT: z.coerce
      .number()
      .int()
      .min(2)
      .max(100)
      .default(95),
    PHOTO_EVIDENCE_RECONCILIATION_ENABLED: booleanValue.default(true),
    PHOTO_EVIDENCE_RECONCILIATION_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(60),
    CAPA_EVIDENCE_UPLOAD_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),
    CAPA_EVIDENCE_S3_ENDPOINT: z.url().default('http://localhost:9000'),
    CAPA_EVIDENCE_S3_REGION: z.string().min(1).max(100).default('us-east-1'),
    CAPA_EVIDENCE_S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default('qualyra-capa-evidence'),
    CAPA_EVIDENCE_S3_ACCESS_KEY: z.string().min(3).max(200).default('qualyra'),
    CAPA_EVIDENCE_S3_SECRET_KEY: z
      .string()
      .min(8)
      .max(200)
      .default('qualyra_dev_change_me'),
    CAPA_EVIDENCE_S3_FORCE_PATH_STYLE: booleanValue.default(true),
    CAPA_EVIDENCE_S3_AUTO_CREATE_BUCKET: booleanValue.default(true),
    CAPA_EVIDENCE_SCANNER: z.enum(['built-in', 'clamav']).default('built-in'),
    CAPA_EVIDENCE_CLAMAV_HOST: z.string().min(1).max(253).default('127.0.0.1'),
    CAPA_EVIDENCE_CLAMAV_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(3310),
    CAPA_EVIDENCE_CLAMAV_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(120_000)
      .default(30_000),
    CAPA_EVIDENCE_RETENTION_ENABLED: booleanValue.default(true),
    CAPA_EVIDENCE_RETENTION_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(60),
    CAPA_MONITORING_ENABLED: booleanValue.default(true),
    CAPA_MONITORING_INTERVAL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(15),
    OUTBOX_WORKER_ENABLED: booleanValue.default(true),
    OUTBOX_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(250)
      .max(300_000)
      .default(5_000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(25).default(8),
    OUTBOX_LOCK_TIMEOUT_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(1440)
      .default(15),
    OUTBOX_RETRY_BASE_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3600)
      .default(30),
    OUTBOX_RETRY_MAX_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(86_400)
      .default(3600),
    OUTBOX_PAYLOAD_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .default(
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      ),
  })
  .superRefine((environment, context) => {
    for (const origin of parseAllowedOrigins(
      environment.CORS_ALLOWED_ORIGINS,
    )) {
      try {
        const parsed = new URL(origin);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.origin !== origin
        ) {
          throw new Error('Invalid web origin.');
        }
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ALLOWED_ORIGINS'],
          message: 'CORS origins must be exact HTTP(S) origins.',
        });
      }
    }

    if (environment.COOKIE_NAME === environment.CSRF_COOKIE_NAME) {
      context.addIssue({
        code: 'custom',
        path: ['CSRF_COOKIE_NAME'],
        message: 'Refresh and CSRF cookies must have different names.',
      });
    }

    if (Boolean(environment.SMTP_USER) !== Boolean(environment.SMTP_PASSWORD)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER', 'SMTP_PASSWORD'],
        message: 'SMTP_USER and SMTP_PASSWORD must be provided together.',
      });
    }

    if (
      environment.PHOTO_EVIDENCE_MAX_BYTES > environment.CAPA_EVIDENCE_MAX_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PHOTO_EVIDENCE_MAX_BYTES'],
        message:
          'PHOTO_EVIDENCE_MAX_BYTES cannot exceed the managed evidence scanner limit.',
      });
    }

    if (
      environment.PHOTO_EVIDENCE_CAPACITY_WARNING_PERCENT >=
      environment.PHOTO_EVIDENCE_CAPACITY_CRITICAL_PERCENT
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PHOTO_EVIDENCE_CAPACITY_WARNING_PERCENT'],
        message:
          'PHOTO_EVIDENCE_CAPACITY_WARNING_PERCENT must be lower than the critical threshold.',
      });
    }

    const planQuotas = [
      environment.PHOTO_EVIDENCE_TENANT_QUOTA_BYTES,
      environment.PHOTO_EVIDENCE_STARTER_QUOTA_BYTES,
      environment.PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES,
      environment.PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES,
    ];
    if (
      planQuotas.some(
        (quota, index) => index > 0 && quota < planQuotas[index - 1],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES'],
        message: 'Photographic evidence quotas must not decrease across plans.',
      });
    }

    if (environment.NODE_ENV !== 'production') return;

    if (!environment.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production.',
      });
    }

    if (!environment.COOKIE_NAME.startsWith('__Host-')) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_NAME'],
        message: 'COOKIE_NAME must use the __Host- prefix in production.',
      });
    }

    if (!environment.CSRF_COOKIE_NAME.startsWith('__Host-')) {
      context.addIssue({
        code: 'custom',
        path: ['CSRF_COOKIE_NAME'],
        message: 'CSRF_COOKIE_NAME must use the __Host- prefix in production.',
      });
    }

    for (const [field, value] of [
      ['APP_BASE_URL', environment.APP_BASE_URL],
      ['WEB_BASE_URL', environment.WEB_BASE_URL],
      ...parseAllowedOrigins(environment.CORS_ALLOWED_ORIGINS).map(
        (origin) => ['CORS_ALLOWED_ORIGINS', origin] as const,
      ),
    ] as const) {
      if (!value.startsWith('https://')) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} must use HTTPS in production.`,
        });
      }
    }

    if (!environment.SMTP_REQUIRE_TLS) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_REQUIRE_TLS'],
        message: 'SMTP_REQUIRE_TLS must be true in production.',
      });
    }

    if (!environment.REDIS_URL.startsWith('rediss://')) {
      context.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL must use TLS in production.',
      });
    }

    if (
      environment.METRICS_ENABLED &&
      (environment.METRICS_BEARER_TOKEN === 'qualyra_local_metrics_token' ||
        environment.METRICS_BEARER_TOKEN.length < 32)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['METRICS_BEARER_TOKEN'],
        message: 'A dedicated metrics bearer token is required in production.',
      });
    }

    if (
      environment.PLATFORM_ADMIN_ENABLED &&
      (environment.PLATFORM_ADMIN_BEARER_TOKEN ===
        'qualyra_local_platform_admin_token' ||
        environment.PLATFORM_ADMIN_BEARER_TOKEN.length < 48)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PLATFORM_ADMIN_BEARER_TOKEN'],
        message:
          'A dedicated platform administration bearer token is required when the production API is enabled.',
      });
    }

    if (environment.CAPA_EVIDENCE_STORAGE_DRIVER !== 's3') {
      context.addIssue({
        code: 'custom',
        path: ['CAPA_EVIDENCE_STORAGE_DRIVER'],
        message: 'CAPA evidence must use S3-compatible storage in production.',
      });
    }

    if (!environment.CAPA_EVIDENCE_S3_ENDPOINT.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['CAPA_EVIDENCE_S3_ENDPOINT'],
        message: 'CAPA evidence S3 transport must use HTTPS in production.',
      });
    }

    if (environment.CAPA_EVIDENCE_S3_AUTO_CREATE_BUCKET) {
      context.addIssue({
        code: 'custom',
        path: ['CAPA_EVIDENCE_S3_AUTO_CREATE_BUCKET'],
        message:
          'CAPA evidence buckets must be provisioned outside the application in production.',
      });
    }

    if (environment.CAPA_EVIDENCE_SCANNER !== 'clamav') {
      context.addIssue({
        code: 'custom',
        path: ['CAPA_EVIDENCE_SCANNER'],
        message: 'CAPA evidence must use an external antivirus in production.',
      });
    }

    if (
      environment.OUTBOX_PAYLOAD_ENCRYPTION_KEY ===
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['OUTBOX_PAYLOAD_ENCRYPTION_KEY'],
        message: 'A dedicated outbox encryption key is required in production.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(values);

  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join('.') || 'environment')
      .join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  return result.data;
}

export function parseAllowedOrigins(value: string): string[] {
  return [...new Set(value.split(',').map((origin) => origin.trim()))].filter(
    Boolean,
  );
}

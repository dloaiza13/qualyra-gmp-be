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
    REDIS_URL: z.string().startsWith('redis://'),
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
    SMTP_FROM: z.string().min(3).max(320),
    ALLOW_PUBLIC_TENANT_REGISTRATION: booleanValue,
    TRUST_PROXY: z.string().default('false'),
    REQUEST_BODY_LIMIT: z
      .string()
      .regex(/^\d+(kb|mb)$/i)
      .default('1mb'),
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

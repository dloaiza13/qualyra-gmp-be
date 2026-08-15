import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool, type PoolClient } from 'pg';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import {
  AuthenticationNotifier,
  type AuthenticationEmail,
} from '../src/modules/authentication/domain/ports/authentication-notifier.js';

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const origin = 'http://localhost:5173';

interface AuthenticationBody {
  accessToken: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    emailVerifiedAt: string | null;
  };
  tenant: { id: string; name: string; slug: string };
}

interface ErrorBody {
  code: string;
  message: string;
}

interface SessionBody {
  id: string;
  isCurrent: boolean;
  status: string;
}

class RecordingAuthenticationNotifier extends AuthenticationNotifier {
  readonly verifications: AuthenticationEmail[] = [];
  readonly passwordResets: AuthenticationEmail[] = [];
  readonly invitations: AuthenticationEmail[] = [];

  sendEmailVerification(message: AuthenticationEmail): Promise<void> {
    this.verifications.push({ ...message });
    return Promise.resolve();
  }

  sendPasswordReset(message: AuthenticationEmail): Promise<void> {
    this.passwordResets.push({ ...message });
    return Promise.resolve();
  }

  sendInvitation(message: AuthenticationEmail): Promise<void> {
    this.invitations.push({ ...message });
    return Promise.resolve();
  }
}

describeDatabase('Authentication lifecycle', () => {
  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationDatabaseUrl) {
    throw new Error(
      'MIGRATION_DATABASE_URL is required for authentication integration tests.',
    );
  }

  const ownerPool = new Pool({
    connectionString: migrationDatabaseUrl,
    max: 2,
  });
  const notifier = new RecordingAuthenticationNotifier();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const tenantSlug = `auth-${suffix}`;
  const email = `admin-${suffix}@example.test`;
  const originalPassword = 'Original passphrase! 2026';
  const newPassword = 'Updated passphrase! 2026';
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthenticationNotifier)
      .useValue(notifier)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useLogger(false);
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await ownerPool.end();
  });

  it('covers registration, sessions, refresh rotation, recovery and verification', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/api/v1/auth/tenant-availability')
      .query({ slug: tenantSlug })
      .expect(200)
      .expect({ available: true });

    const registration = await request(server)
      .post('/api/v1/auth/register-company')
      .send({
        tenantName: 'Authentication Test Company',
        tenantSlug,
        adminName: 'Test Administrator',
        email,
        password: originalPassword,
      })
      .expect(201);
    const registrationBody = bodyAs<AuthenticationBody>(registration);
    const registrationCookies = cookieHeader(registration);
    const registrationRefreshToken = readCookie(
      registrationCookies,
      'qualyra_refresh',
    );

    expect(registrationBody.accessToken).toEqual(expect.any(String));
    expect(registrationBody.csrfToken).toEqual(expect.any(String));
    expect(registrationBody.user).toMatchObject({
      email,
      status: 'ACTIVE',
      emailVerifiedAt: null,
    });
    expect(registrationBody.tenant.slug).toBe(tenantSlug);
    expect(JSON.stringify(registrationBody)).not.toMatch(
      /passwordHash|tokenHash|refreshToken/i,
    );
    expect(notifier.verifications).toHaveLength(1);
    expect(registrationRefreshToken).toMatch(/^v1\./);
    expectCookieSecurity(registration);

    await request(server)
      .get('/api/v1/auth/tenant-availability')
      .query({ slug: tenantSlug })
      .expect(200)
      .expect({ available: false });

    await expectProvisionedTenant(
      ownerPool,
      registrationBody.tenant.id,
      registrationBody.user.id,
      originalPassword,
      registrationRefreshToken,
    );

    const duplicate = await request(server)
      .post('/api/v1/auth/register-company')
      .send({
        tenantName: 'Duplicate Company',
        tenantSlug,
        adminName: 'Another Administrator',
        email: `duplicate-${email}`,
        password: originalPassword,
      })
      .expect(409);
    expect(bodyAs<ErrorBody>(duplicate).code).toBe('SLUG_ALREADY_EXISTS');
    await request(server)
      .post('/api/v1/auth/register-user')
      .send({})
      .expect(404);

    const unknownLogin = await login(
      server,
      'tenant-does-not-exist',
      email,
      originalPassword,
      401,
    );
    const wrongPasswordLogin = await login(
      server,
      tenantSlug,
      email,
      'Incorrect passphrase! 2026',
      401,
    );
    expect(pickPublicError(unknownLogin)).toEqual(
      pickPublicError(wrongPasswordLogin),
    );
    expect(pickPublicError(unknownLogin)).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'The credentials are invalid.',
    });

    const successfulLogin = await login(
      server,
      tenantSlug,
      email,
      originalPassword,
      200,
    );
    const loginBody = bodyAs<AuthenticationBody>(successfulLogin);
    let loginCookies = cookieHeader(successfulLogin);

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(200);
    expect(JSON.stringify(bodyAs<unknown>(me))).not.toMatch(
      /passwordHash|tokenHash|refreshToken/i,
    );

    const sessionsResponse = await request(server)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(200);
    const sessions = bodyAs<SessionBody[]>(sessionsResponse);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter(({ isCurrent }) => isCurrent)).toHaveLength(1);

    const registrationSession = sessions.find(({ isCurrent }) => !isCurrent);
    expect(registrationSession).toBeDefined();
    await request(server)
      .delete(`/api/v1/auth/sessions/${registrationSession?.id ?? ''}`)
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(204);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${registrationBody.accessToken}`)
      .expect(401);

    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', loginCookies)
      .expect(403);

    const preRotationCookies = loginCookies;
    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('x-csrf-token', loginBody.csrfToken)
      .set('Cookie', preRotationCookies)
      .expect(200);
    const rotatedBody = bodyAs<AuthenticationBody>(rotated);
    loginCookies = cookieHeader(rotated);
    expect(readCookie(loginCookies, 'qualyra_refresh')).not.toBe(
      readCookie(preRotationCookies, 'qualyra_refresh'),
    );

    const reuse = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('x-csrf-token', loginBody.csrfToken)
      .set('Cookie', preRotationCookies)
      .expect(401);
    expect(bodyAs<ErrorBody>(reuse).code).toBe('SESSION_REVOKED');
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedBody.accessToken}`)
      .expect(401);

    const logoutLogin = await login(
      server,
      tenantSlug,
      email,
      originalPassword,
      200,
    );
    const logoutBody = bodyAs<AuthenticationBody>(logoutLogin);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('x-csrf-token', logoutBody.csrfToken)
      .set('Cookie', cookieHeader(logoutLogin))
      .expect(204);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${logoutBody.accessToken}`)
      .expect(401);

    const firstAllLogin = await login(
      server,
      tenantSlug,
      email,
      originalPassword,
      200,
    );
    const secondAllLogin = await login(
      server,
      tenantSlug,
      email,
      originalPassword,
      200,
    );
    const firstAllBody = bodyAs<AuthenticationBody>(firstAllLogin);
    const secondAllBody = bodyAs<AuthenticationBody>(secondAllLogin);
    await request(server)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${secondAllBody.accessToken}`)
      .set('Origin', origin)
      .set('x-csrf-token', secondAllBody.csrfToken)
      .set('Cookie', cookieHeader(secondAllLogin))
      .expect(204);
    await expectAccessRejected(server, firstAllBody.accessToken);
    await expectAccessRejected(server, secondAllBody.accessToken);

    const resetSession = await login(
      server,
      tenantSlug,
      email,
      originalPassword,
      200,
    );
    const resetSessionBody = bodyAs<AuthenticationBody>(resetSession);
    const resetCount = notifier.passwordResets.length;
    const unknownForgot = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ tenant: tenantSlug, email: `unknown-${email}` })
      .expect(200);
    const knownForgot = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ tenant: tenantSlug, email })
      .expect(200);
    expect(bodyAs<{ accepted: boolean }>(unknownForgot)).toEqual(
      bodyAs<{ accepted: boolean }>(knownForgot),
    );
    expect(notifier.passwordResets).toHaveLength(resetCount + 1);

    const resetToken = notifier.passwordResets.at(-1)?.token;
    expect(resetToken).toBeDefined();
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword })
      .expect(200);
    await expectAccessRejected(server, resetSessionBody.accessToken);
    await login(server, tenantSlug, email, originalPassword, 401);
    const afterResetLogin = await login(
      server,
      tenantSlug,
      email,
      newPassword,
      200,
    );
    const afterResetBody = bodyAs<AuthenticationBody>(afterResetLogin);

    const verificationToken = notifier.verifications.at(0)?.token;
    expect(verificationToken).toBeDefined();
    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token: verificationToken })
      .expect(200);
    const verifiedMe = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${afterResetBody.accessToken}`)
      .expect(200);
    expect(
      bodyAs<{ user: { emailVerifiedAt: string | null } }>(verifiedMe).user
        .emailVerifiedAt,
    ).toEqual(expect.any(String));

    await expectSecurityEvents(ownerPool, registrationBody.tenant.id);
  }, 60_000);
});

async function login(
  server: Parameters<typeof request>[0],
  tenant: string,
  email: string,
  password: string,
  status: number,
): Promise<Response> {
  return request(server)
    .post('/api/v1/auth/login')
    .send({ tenant, email, password })
    .expect(status);
}

async function expectAccessRejected(
  server: Parameters<typeof request>[0],
  accessToken: string,
): Promise<void> {
  await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(401);
}

function bodyAs<T>(response: Response): T {
  return response.body as T;
}

function setCookies(response: Response): string[] {
  const value: unknown = response.headers['set-cookie'];
  if (Array.isArray(value)) {
    return value.filter(
      (cookie): cookie is string => typeof cookie === 'string',
    );
  }
  return typeof value === 'string' ? [value] : [];
}

function cookieHeader(response: Response): string {
  return setCookies(response)
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

function readCookie(header: string, name: string): string {
  const prefix = `${name}=`;
  const value = header
    .split('; ')
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) throw new Error(`Cookie ${name} was not set.`);
  return value;
}

function expectCookieSecurity(response: Response): void {
  const cookies = setCookies(response);
  const refresh = cookies.find((cookie) =>
    cookie.startsWith('qualyra_refresh='),
  );
  const csrf = cookies.find((cookie) => cookie.startsWith('qualyra_csrf='));
  expect(refresh).toContain('HttpOnly');
  expect(refresh).toContain('SameSite=Strict');
  expect(refresh).toContain('Path=/');
  expect(refresh).toContain('Max-Age=');
  expect(csrf).not.toContain('HttpOnly');
  expect(csrf).toContain('SameSite=Strict');
}

function pickPublicError(response: Response): ErrorBody {
  const body = bodyAs<ErrorBody>(response);
  return { code: body.code, message: body.message };
}

async function expectProvisionedTenant(
  pool: Pool,
  tenantId: string,
  userId: string,
  rawPassword: string,
  rawRefreshToken: string,
): Promise<void> {
  await withTenant(pool, tenantId, async (client) => {
    const userResult = await client.query<{
      password_hash: string;
      role_name: string;
    }>(
      `SELECT u.password_hash, r.name AS role_name
       FROM users u
       JOIN user_roles ur ON ur.tenant_id = u.tenant_id AND ur.user_id = u.id
       JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
       WHERE u.id = $1`,
      [userId],
    );
    expect(userResult.rows).toHaveLength(1);
    expect(userResult.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(userResult.rows[0]?.password_hash).not.toContain(rawPassword);
    expect(userResult.rows[0]?.role_name).toBe('Administrator');

    const rolesResult = await client.query<{ name: string }>(
      'SELECT name FROM roles ORDER BY name',
    );
    expect(rolesResult.rows.map(({ name }) => name)).toEqual([
      'Administrator',
      'Auditor',
      'Document Controller',
      'Operator',
      'QA Manager',
    ]);

    const permissionsResult = await client.query<{
      catalog_count: number;
      assigned_count: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM permissions) AS catalog_count,
         (SELECT COUNT(*)::int
          FROM role_permissions rp
          JOIN roles r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
          WHERE r.name = 'Administrator') AS assigned_count`,
    );
    expect(permissionsResult.rows[0]?.catalog_count).toBeGreaterThan(0);
    expect(permissionsResult.rows[0]?.assigned_count).toBe(
      permissionsResult.rows[0]?.catalog_count,
    );

    const tokenResult = await client.query<{ token_hash: string }>(
      'SELECT token_hash FROM refresh_tokens WHERE user_id = $1',
      [userId],
    );
    expect(tokenResult.rows).toHaveLength(1);
    expect(tokenResult.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenResult.rows[0]?.token_hash).not.toBe(rawRefreshToken);
  });
}

async function expectSecurityEvents(
  pool: Pool,
  tenantId: string,
): Promise<void> {
  await withTenant(pool, tenantId, async (client) => {
    const result = await client.query<{ event_type: string }>(
      'SELECT event_type FROM security_events WHERE tenant_id = $1',
      [tenantId],
    );
    const eventTypes = result.rows.map(({ event_type }) => event_type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'TENANT_REGISTERED',
        'LOGIN_SUCCEEDED',
        'LOGIN_FAILED',
        'REFRESH_TOKEN_REUSE_DETECTED',
        'SESSION_REVOKED',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_COMPLETED',
        'EMAIL_VERIFIED',
      ]),
    );
  });
}

async function withTenant(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    await operation(client);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

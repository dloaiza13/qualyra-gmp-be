import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool, type PoolClient } from 'pg';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import {
  AuthenticationNotifier,
  type InvitationEmail,
} from '../src/modules/authentication/domain/ports/authentication-notifier.js';

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

interface AuthenticationBody {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string; slug: string };
}

interface ErrorBody {
  code: string;
}

interface PermissionBody {
  id: string;
  code: string;
}

interface RoleBody {
  id: string;
  name: string;
  permissions: PermissionBody[];
}

interface UserBody {
  id: string;
  email: string;
  status: string;
  roles: { id: string; name: string }[];
}

interface InvitationBody {
  id: string;
  email: string;
  status: string;
  roles: { id: string; name: string }[];
  lastSentAt: string;
}

interface SecurityEventBody {
  eventType: string;
}

class RecordingNotifier extends AuthenticationNotifier {
  readonly invitations: InvitationEmail[] = [];

  sendEmailVerification(): Promise<void> {
    return Promise.resolve();
  }

  sendPasswordReset(): Promise<void> {
    return Promise.resolve();
  }

  sendInvitation(message: InvitationEmail): Promise<void> {
    this.invitations.push({ ...message, roles: [...message.roles] });
    return Promise.resolve();
  }
}

describeDatabase('RBAC and invitation lifecycle', () => {
  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationDatabaseUrl) {
    throw new Error(
      'MIGRATION_DATABASE_URL is required for integration tests.',
    );
  }

  const ownerPool = new Pool({
    connectionString: migrationDatabaseUrl,
    max: 2,
  });
  const notifier = new RecordingNotifier();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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

  it('enforces tenant permissions and invitation-only onboarding', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `rbac-a-${suffix}`);
    const tenantB = await registerCompany(server, `rbac-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);

    const permissionsResponse = await request(server)
      .get('/api/v1/roles/permissions')
      .set(authA)
      .expect(200);
    const permissions = bodyAs<PermissionBody[]>(permissionsResponse);
    const usersRead = permissions.find(({ code }) => code === 'users.read');
    expect(usersRead).toBeDefined();

    const rolesAResponse = await request(server)
      .get('/api/v1/roles')
      .set(authA)
      .expect(200);
    const rolesA = bodyAs<RoleBody[]>(rolesAResponse);
    const administratorA = roleNamed(rolesA, 'Administrator');
    const operatorA = roleNamed(rolesA, 'Operator');
    const qaManagerA = roleNamed(rolesA, 'QA Manager');
    const documentControllerA = roleNamed(rolesA, 'Document Controller');
    const auditorA = roleNamed(rolesA, 'Auditor');

    expect(permissionCodes(operatorA)).toEqual(
      expect.arrayContaining([
        'documents.read',
        'training.complete',
        'deviations.create',
        'capas.execute',
        'audits.respond',
        'risks.mitigate',
        'equipment.maintain',
        'complaints.create',
      ]),
    );
    for (const permission of [
      'deviations.read_all',
      'suppliers.read',
      'recalls.read',
      'product_reviews.read',
    ]) {
      expect(permissionCodes(operatorA)).not.toContain(permission);
    }
    expect(permissionCodes(documentControllerA)).toEqual(
      expect.arrayContaining([
        'documents.read_all',
        'documents.release',
        'training.assign',
        'capas.execute',
        'changes.implement',
        'audits.respond',
      ]),
    );
    for (const permission of [
      'deviations.read',
      'risks.read',
      'suppliers.read',
      'equipment.read',
    ]) {
      expect(permissionCodes(documentControllerA)).not.toContain(permission);
    }
    expect(permissionCodes(qaManagerA)).toEqual(
      expect.arrayContaining([
        'documents.read_all',
        'deviations.read_all',
        'suppliers.approve',
        'equipment.verify',
        'recalls.close',
        'product_reviews.approve',
      ]),
    );
    for (const permission of [
      'tenants.read',
      'users.read',
      'roles.read',
      'documents.release',
    ]) {
      expect(permissionCodes(qaManagerA)).not.toContain(permission);
    }
    expect(permissionCodes(auditorA)).toEqual(
      expect.arrayContaining([
        'security.events.read',
        'documents.read_all',
        'audits.execute',
        'audits.review',
        'product_reviews.read_all',
      ]),
    );
    for (const permission of [
      'risks.review',
      'suppliers.approve',
      'equipment.verify',
      'complaints.review',
      'recalls.approve',
      'product_reviews.approve',
    ]) {
      expect(permissionCodes(auditorA)).not.toContain(permission);
    }

    const rolesBResponse = await request(server)
      .get('/api/v1/roles')
      .set(bearer(tenantB.accessToken))
      .expect(200);
    const operatorB = roleNamed(bodyAs<RoleBody[]>(rolesBResponse), 'Operator');

    const crossTenantUser = await request(server)
      .get(`/api/v1/users/${tenantB.user.id}`)
      .set(authA)
      .expect(404);
    expect(bodyAs<ErrorBody>(crossTenantUser).code).toBe('NOT_FOUND');

    const crossTenantRole = await request(server)
      .patch(`/api/v1/users/${tenantA.user.id}/roles`)
      .set(authA)
      .send({ roleIds: [operatorB.id] })
      .expect(400);
    expect(bodyAs<ErrorBody>(crossTenantRole).code).toBe('ROLE_INVALID');

    const lastAdminStatus = await request(server)
      .patch(`/api/v1/users/${tenantA.user.id}/status`)
      .set(authA)
      .send({ status: 'DISABLED' })
      .expect(409);
    expect(bodyAs<ErrorBody>(lastAdminStatus).code).toBe(
      'LAST_ADMINISTRATOR_REQUIRED',
    );
    const lastAdminRole = await request(server)
      .patch(`/api/v1/users/${tenantA.user.id}/roles`)
      .set(authA)
      .send({ roleIds: [operatorA.id] })
      .expect(409);
    expect(bodyAs<ErrorBody>(lastAdminRole).code).toBe(
      'LAST_ADMINISTRATOR_REQUIRED',
    );

    const restrictedRoleResponse = await request(server)
      .post('/api/v1/roles')
      .set(authA)
      .send({
        name: `Read only ${suffix}`,
        description: 'Can only view users.',
        permissionIds: [usersRead?.id],
      })
      .expect(201);
    const restrictedRole = bodyAs<RoleBody>(restrictedRoleResponse);
    expect(restrictedRole.permissions.map(({ code }) => code)).toEqual([
      'users.read',
    ]);

    const updatedRole = await request(server)
      .patch(`/api/v1/roles/${restrictedRole.id}`)
      .set(authA)
      .send({ description: 'Read-only directory access.' })
      .expect(200);
    expect(bodyAs<RoleBody>(updatedRole)).toMatchObject({
      id: restrictedRole.id,
      name: restrictedRole.name,
    });

    const invitedEmail = `invited-${suffix}@example.test`;
    const invitationResponse = await request(server)
      .post('/api/v1/users/invitations')
      .set(authA)
      .send({ email: invitedEmail, roleIds: [restrictedRole.id] })
      .expect(201);
    const invitation = bodyAs<InvitationBody>(invitationResponse);
    expect(invitation).toMatchObject({
      email: invitedEmail,
      status: 'PENDING',
    });
    expect(JSON.stringify(invitation)).not.toMatch(/tokenHash|token/i);
    const originalInvitationToken = notifier.invitations.at(-1)?.token;
    expect(originalInvitationToken).toBeDefined();

    const resentResponse = await request(server)
      .post(`/api/v1/users/invitations/${invitation.id}/resend`)
      .set(authA)
      .expect(200);
    const resentInvitation = bodyAs<InvitationBody>(resentResponse);
    const invitationToken = notifier.invitations.at(-1)?.token;
    expect(invitationToken).toBeDefined();
    expect(invitationToken).not.toBe(originalInvitationToken);
    expect(
      new Date(resentInvitation.lastSentAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(invitation.lastSentAt).getTime());

    const invalidatedPreview = await request(server)
      .post('/api/v1/invitations/preview')
      .send({ token: originalInvitationToken })
      .expect(400);
    expect(bodyAs<ErrorBody>(invalidatedPreview).code).toBe(
      'INVITATION_INVALID',
    );

    const preview = await request(server)
      .post('/api/v1/invitations/preview')
      .send({ token: invitationToken })
      .expect(200);
    expect(
      bodyAs<{ email: string; tenantSlug: string }>(preview),
    ).toMatchObject({
      email: invitedEmail,
      tenantSlug: tenantA.tenant.slug,
    });

    const acceptedResponse = await request(server)
      .post('/api/v1/invitations/accept')
      .send({
        token: invitationToken,
        displayName: 'Invited Operator',
        password: 'Invited user passphrase! 2026',
      })
      .expect(200);
    const accepted = bodyAs<AuthenticationBody>(acceptedResponse);
    expect(accepted.user.email).toBe(invitedEmail);
    expect(JSON.stringify(accepted)).not.toMatch(
      /passwordHash|tokenHash|refreshToken/i,
    );
    const reused = await request(server)
      .post('/api/v1/invitations/accept')
      .send({
        token: invitationToken,
        displayName: 'Reuse Attempt',
        password: 'Invited user passphrase! 2026',
      })
      .expect(400);
    expect(bodyAs<ErrorBody>(reused).code).toBe('INVITATION_INVALID');

    await request(server)
      .get('/api/v1/users')
      .set(bearer(accepted.accessToken))
      .expect(200);
    const forbiddenRoles = await request(server)
      .get('/api/v1/roles')
      .set(bearer(accepted.accessToken))
      .expect(403);
    expect(bodyAs<ErrorBody>(forbiddenRoles).code).toBe('FORBIDDEN');
    await request(server)
      .post('/api/v1/users/invitations')
      .set(bearer(accepted.accessToken))
      .send({
        email: `forbidden-${suffix}@example.test`,
        roleIds: [operatorA.id],
      })
      .expect(403);

    const usersResponse = await request(server)
      .get('/api/v1/users')
      .set(authA)
      .expect(200);
    const invitedUser = bodyAs<UserBody[]>(usersResponse).find(
      ({ email }) => email === invitedEmail,
    );
    expect(invitedUser?.roles.map(({ name }) => name)).toEqual([
      restrictedRole.name,
    ]);

    const assigned = await request(server)
      .patch(`/api/v1/users/${invitedUser?.id ?? ''}/roles`)
      .set(authA)
      .send({ roleIds: [operatorA.id] })
      .expect(200);
    expect(bodyAs<UserBody>(assigned).roles.map(({ name }) => name)).toEqual([
      'Operator',
    ]);

    await request(server)
      .patch(`/api/v1/users/${invitedUser?.id ?? ''}/status`)
      .set(authA)
      .send({ status: 'DISABLED' })
      .expect(200);
    await request(server)
      .get('/api/v1/auth/me')
      .set(bearer(accepted.accessToken))
      .expect(401);

    const crossInvite = await request(server)
      .post('/api/v1/users/invitations')
      .set(authA)
      .send({
        email: `cross-role-${suffix}@example.test`,
        roleIds: [operatorB.id],
      })
      .expect(400);
    expect(bodyAs<ErrorBody>(crossInvite).code).toBe('ROLE_INVALID');

    const expiredEmail = `expired-${suffix}@example.test`;
    const expiredResponse = await request(server)
      .post('/api/v1/users/invitations')
      .set(authA)
      .send({ email: expiredEmail, roleIds: [operatorA.id] })
      .expect(201);
    const expiredInvitation = bodyAs<InvitationBody>(expiredResponse);
    const expiredToken = notifier.invitations.at(-1)?.token;
    await expireInvitation(ownerPool, tenantA.tenant.id, expiredInvitation.id);
    const expiredAccept = await request(server)
      .post('/api/v1/invitations/accept')
      .send({
        token: expiredToken,
        displayName: 'Expired User',
        password: 'Expired user passphrase! 2026',
      })
      .expect(400);
    expect(bodyAs<ErrorBody>(expiredAccept).code).toBe('INVITATION_EXPIRED');

    const revokedResponse = await request(server)
      .post('/api/v1/users/invitations')
      .set(authA)
      .send({
        email: `revoked-${suffix}@example.test`,
        roleIds: [operatorA.id],
      })
      .expect(201);
    const revokedInvitation = bodyAs<InvitationBody>(revokedResponse);
    const revokedToken = notifier.invitations.at(-1)?.token;
    await request(server)
      .delete(`/api/v1/users/invitations/${revokedInvitation.id}`)
      .set(authA)
      .expect(204);
    await request(server)
      .post('/api/v1/invitations/accept')
      .send({
        token: revokedToken,
        displayName: 'Revoked User',
        password: 'Revoked user passphrase! 2026',
      })
      .expect(400);

    const invitationsList = await request(server)
      .get('/api/v1/users/invitations')
      .set(authA)
      .expect(200);
    expect(JSON.stringify(bodyAs<unknown>(invitationsList))).not.toMatch(
      /tokenHash|\.token/i,
    );

    const eventsResponse = await request(server)
      .get('/api/v1/security-events?limit=100')
      .set(authA)
      .expect(200);
    const eventTypes = bodyAs<SecurityEventBody[]>(eventsResponse).map(
      ({ eventType }) => eventType,
    );
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'USER_INVITED',
        'INVITATION_ACCEPTED',
        'INVITATION_RESENT',
        'INVITATION_REVOKED',
        'USER_ROLES_CHANGED',
        'USER_STATUS_CHANGED',
        'ROLE_CREATED',
        'ROLE_UPDATED',
      ]),
    );

    await expectStoredInvitationAndUser(
      ownerPool,
      tenantA.tenant.id,
      invitation.id,
      invitationToken ?? '',
      invitedEmail,
    );
    expect(administratorA.permissions.length).toBeGreaterThan(0);
  }, 90_000);
});

async function registerCompany(
  server: Parameters<typeof request>[0],
  slug: string,
): Promise<AuthenticationBody> {
  const response = await request(server)
    .post('/api/v1/auth/register-company')
    .send({
      tenantName: `Company ${slug}`,
      tenantSlug: slug,
      adminName: 'Tenant Administrator',
      email: `admin-${slug}@example.test`,
      password: 'Administration passphrase! 2026',
    })
    .expect(201);
  return bodyAs<AuthenticationBody>(response);
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function roleNamed(roles: RoleBody[], name: string): RoleBody {
  const role = roles.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`Role ${name} was not found.`);
  return role;
}

function permissionCodes(role: RoleBody): string[] {
  return role.permissions.map(({ code }) => code);
}

function bodyAs<T>(response: Response): T {
  return response.body as T;
}

async function expireInvitation(
  pool: Pool,
  tenantId: string,
  invitationId: string,
): Promise<void> {
  await withTenant(pool, tenantId, async (client) => {
    await client.query(
      `UPDATE invitations
       SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days',
           expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'
       WHERE id = $1`,
      [invitationId],
    );
  });
}

async function expectStoredInvitationAndUser(
  pool: Pool,
  tenantId: string,
  invitationId: string,
  rawToken: string,
  email: string,
): Promise<void> {
  await withTenant(pool, tenantId, async (client) => {
    const invitation = await client.query<{
      token_hash: string;
      status: string;
    }>('SELECT token_hash, status FROM invitations WHERE id = $1', [
      invitationId,
    ]);
    expect(invitation.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.rows[0]?.token_hash).not.toBe(rawToken);
    expect(invitation.rows[0]?.status).toBe('ACCEPTED');

    const user = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [email],
    );
    expect(user.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
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

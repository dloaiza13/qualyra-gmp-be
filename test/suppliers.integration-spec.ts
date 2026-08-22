import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import {
  AuthenticationNotifier,
  type InvitationEmail,
} from '../src/modules/authentication/domain/ports/authentication-notifier.js';

const describeDatabase =
  process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

interface AuthenticationBody {
  accessToken: string;
  user: { id: string; email: string };
}
interface RoleBody {
  id: string;
  name: string;
  permissions: { code: string }[];
}
interface SupplierBody {
  id: string;
  code: string;
  status: string;
  approvedList: boolean;
  qualifications: {
    id: string;
    status: string;
    overallScore: number;
    recordHash: string;
    decision: { decision: string; recordHash: string } | null;
  }[];
  scars: {
    id: string;
    code: string;
    status: string;
    responses: {
      id: string;
      attemptNumber: number;
      decision: string | null;
      responseRecordHash: string;
      reviewRecordHash: string | null;
    }[];
  }[];
}
interface ErrorBody {
  code: string;
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

describeDatabase('supplier quality management lifecycle', () => {
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

  afterAll(async () => app.close());

  it('isolates suppliers and preserves independent qualification and SCAR signatures', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `supplier-a-${suffix}`);
    const tenantB = await registerCompany(server, `supplier-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaRole = requiredRole(roles, 'QA Manager');
    expect(qaRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'suppliers.read',
        'suppliers.assess',
        'suppliers.scar',
        'suppliers.approve',
        'suppliers.review_scar',
      ]),
    );

    const owner = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `supplier-owner-${suffix}@example.test`,
      'Supplier Quality Owner',
      'Supplier owner passphrase 2026',
    );
    const approver = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `supplier-approver-${suffix}@example.test`,
      'Supplier Independent Approver',
      'Supplier approver passphrase 2026',
    );

    const created = bodyAs<SupplierBody>(
      await request(server)
        .post('/api/v1/suppliers')
        .set(authA)
        .send(supplierInput(owner.user.id, approver.user.id))
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `SUP-${new Date().getUTCFullYear()}-0001`,
      status: 'PENDING_QUALIFICATION',
      approvedList: false,
    });

    await request(server)
      .get(`/api/v1/suppliers/${created.id}`)
      .set(bearer(tenantB.accessToken))
      .expect(404);

    await request(server)
      .post(`/api/v1/suppliers/${created.id}/qualifications`)
      .set(bearer(owner.accessToken))
      .send(qualificationInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const assessed = bodyAs<SupplierBody>(
      await request(server)
        .post(`/api/v1/suppliers/${created.id}/qualifications`)
        .set(bearer(owner.accessToken))
        .send(qualificationInput('Supplier owner passphrase 2026'))
        .expect(201),
    );
    expect(assessed.qualifications[0]).toMatchObject({
      status: 'PENDING_DECISION',
      overallScore: 85,
    });
    expect(assessed.qualifications[0]?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    const qualificationId = assessed.qualifications[0]?.id;
    if (!qualificationId) throw new Error('Qualification was not created.');

    const approved = bodyAs<SupplierBody>(
      await request(server)
        .post(
          `/api/v1/suppliers/${created.id}/qualifications/${qualificationId}/decision`,
        )
        .set(bearer(approver.accessToken))
        .send(decisionInput('Supplier approver passphrase 2026'))
        .expect(201),
    );
    expect(approved).toMatchObject({ status: 'APPROVED', approvedList: true });
    expect(approved.qualifications[0]?.decision?.recordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const withScar = bodyAs<SupplierBody>(
      await request(server)
        .post(`/api/v1/suppliers/${created.id}/scars`)
        .set(bearer(owner.accessToken))
        .send(scarInput())
        .expect(201),
    );
    expect(withScar.scars[0]).toMatchObject({
      code: `SCAR-${new Date().getUTCFullYear()}-0001`,
      status: 'OPEN',
    });
    const scarId = withScar.scars[0]?.id;
    if (!scarId) throw new Error('SCAR was not created.');

    const firstResponse = await submitResponse(
      server,
      owner,
      created.id,
      scarId,
      'Supplier owner passphrase 2026',
    );
    const firstResponseId = firstResponse.scars[0]?.responses[0]?.id;
    if (!firstResponseId) throw new Error('SCAR response was not created.');
    expect(firstResponse.scars[0]?.status).toBe('RESPONSE_SUBMITTED');
    expect(firstResponse.scars[0]?.responses[0]?.responseRecordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const revision = bodyAs<SupplierBody>(
      await request(server)
        .post(
          `/api/v1/suppliers/${created.id}/scars/${scarId}/responses/${firstResponseId}/review`,
        )
        .set(bearer(approver.accessToken))
        .send(
          reviewInput('REQUEST_REVISION', 'Supplier approver passphrase 2026'),
        )
        .expect(201),
    );
    expect(revision.scars[0]?.status).toBe('OPEN');
    expect(revision.scars[0]?.responses[0]).toMatchObject({
      attemptNumber: 1,
      decision: 'REQUEST_REVISION',
    });

    const secondResponse = await submitResponse(
      server,
      owner,
      created.id,
      scarId,
      'Supplier owner passphrase 2026',
    );
    const secondResponseId = secondResponse.scars[0]?.responses[1]?.id;
    if (!secondResponseId) throw new Error('Second response was not created.');
    const closed = bodyAs<SupplierBody>(
      await request(server)
        .post(
          `/api/v1/suppliers/${created.id}/scars/${scarId}/responses/${secondResponseId}/review`,
        )
        .set(bearer(approver.accessToken))
        .send(reviewInput('ACCEPT', 'Supplier approver passphrase 2026'))
        .expect(201),
    );
    expect(closed.scars[0]?.status).toBe('CLOSED');
    expect(closed.scars[0]?.responses[1]).toMatchObject({
      attemptNumber: 2,
      decision: 'ACCEPT',
    });
    expect(closed.scars[0]?.responses[1]?.reviewRecordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'SUPPLIER_REGISTERED',
        'SUPPLIER_QUALIFICATION_REAUTHENTICATION_FAILED',
        'SUPPLIER_QUALIFICATION_COMPLETED',
        'SUPPLIER_QUALIFICATION_DECIDED',
        'SUPPLIER_SCAR_ISSUED',
        'SUPPLIER_SCAR_RESPONSE_SUBMITTED',
        'SUPPLIER_SCAR_RESPONSE_REVIEWED',
      ]),
    );
  }, 120_000);
});

function supplierInput(qualityOwnerUserId: string, approverUserId: string) {
  return {
    legalName: 'Northstar Active Ingredients Ltd.',
    tradeName: 'Northstar API',
    registrationNumber: `REG-${Date.now()}`,
    category: 'RAW_MATERIAL',
    criticality: 'CRITICAL',
    scopeOfSupply:
      'Manufacture and supply of the validated active ingredient used in commercial batches.',
    manufacturingSite: 'Cartago GMP manufacturing campus',
    countryCode: 'CR',
    contactName: 'Supplier Quality Contact',
    contactEmail: 'quality@northstar.example',
    qualityOwnerUserId,
    approverUserId,
  };
}

function qualificationInput(password: string) {
  return {
    type: 'INITIAL',
    qualitySystemScore: 5,
    complianceScore: 4,
    deliveryScore: 4,
    serviceScore: 4,
    evidenceSummary:
      'Quality agreement, regulatory history, audit evidence, and supply performance were independently verified.',
    recommendation: 'APPROVE',
    password,
    attestationAccepted: true,
  };
}

function decisionInput(password: string) {
  return {
    decision: 'APPROVE',
    rationale:
      'The evidence package and risk-based assessment support approval for the documented supply scope.',
    nextReviewAt: new Date(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    password,
    attestationAccepted: true,
  };
}

function scarInput() {
  return {
    title: 'Incomplete temperature-excursion investigation',
    description:
      'The investigation supplied with lot API-2608 did not include logger calibration traceability.',
    requirementReference: 'Quality Agreement section 8.4',
    severity: 'MAJOR',
    dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function responseInput(password: string) {
  return {
    response:
      'The investigation was revised and the missing calibration traceability was incorporated.',
    rootCause:
      'The investigation template did not require calibration-record verification.',
    correction:
      'Calibration certificates were verified and attached to the investigation.',
    correctiveAction:
      'The template and reviewer checklist were updated, with training assigned to investigation authors.',
    evidenceReference: 'Northstar CAPA NS-2026-044 and training record TR-118',
    password,
    attestationAccepted: true,
  };
}

function reviewInput(
  decision: 'ACCEPT' | 'REQUEST_REVISION',
  password: string,
) {
  return {
    decision,
    comment:
      decision === 'ACCEPT'
        ? 'The revised response includes objective evidence and adequately addresses recurrence risk.'
        : 'Provide effectiveness criteria and the completed training evidence before acceptance.',
    password,
    attestationAccepted: true,
  };
}

async function submitResponse(
  server: Parameters<typeof request>[0],
  owner: AuthenticationBody,
  supplierId: string,
  scarId: string,
  password: string,
): Promise<SupplierBody> {
  return bodyAs<SupplierBody>(
    await request(server)
      .post(`/api/v1/suppliers/${supplierId}/scars/${scarId}/responses`)
      .set(bearer(owner.accessToken))
      .send(responseInput(password))
      .expect(201),
  );
}

function requiredRole(roles: RoleBody[], name: string): RoleBody {
  const role = roles.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`${name} role was not created.`);
  return role;
}

async function inviteAndAccept(
  server: Parameters<typeof request>[0],
  authorization: Record<string, string>,
  notifier: RecordingNotifier,
  roleId: string,
  email: string,
  displayName: string,
  password: string,
): Promise<AuthenticationBody> {
  await request(server)
    .post('/api/v1/users/invitations')
    .set(authorization)
    .send({ email, roleIds: [roleId] })
    .expect(201);
  const token = notifier.invitations.at(-1)?.token;
  if (!token) throw new Error('Invitation token was not recorded.');
  return bodyAs<AuthenticationBody>(
    await request(server)
      .post('/api/v1/invitations/accept')
      .send({ token, displayName, password })
      .expect(200),
  );
}

async function registerCompany(
  server: Parameters<typeof request>[0],
  slug: string,
): Promise<AuthenticationBody> {
  return bodyAs<AuthenticationBody>(
    await request(server)
      .post('/api/v1/auth/register-company')
      .send({
        tenantName: `Supplier ${slug}`,
        tenantSlug: slug,
        adminName: 'Supplier Administrator',
        email: `admin@${slug}.test`,
        password: 'Administration passphrase! 2026',
      })
      .expect(201),
  );
}

function bearer(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

function bodyAs<T>(response: Response): T {
  return response.body as T;
}

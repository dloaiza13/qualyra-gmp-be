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
interface AuditBody {
  id: string;
  code: string;
  status: string;
  findings: {
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
  report: { recordHash: string } | null;
  closure: { recordHash: string } | null;
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

describeDatabase('GMP audit lifecycle', () => {
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

  it('isolates tenants and preserves signed report, response attempts, reviews, and closure', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `audit-a-${suffix}`);
    const tenantB = await registerCompany(server, `audit-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const authB = bearer(tenantB.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaRole = requiredRole(roles, 'QA Manager');
    const operatorRole = requiredRole(roles, 'Operator');
    expect(qaRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'audits.read',
        'audits.plan',
        'audits.execute',
        'audits.respond',
        'audits.review',
        'audits.close',
      ]),
    );

    const lead = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `audit-lead-${suffix}@example.test`,
      'Lead Auditor',
      'Lead auditor passphrase 2026',
    );
    const reviewer = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `audit-reviewer-${suffix}@example.test`,
      'Audit Reviewer',
      'Audit reviewer passphrase 2026',
    );
    const responsible = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `audit-owner-${suffix}@example.test`,
      'Finding Owner',
      'Finding owner passphrase 2026',
    );

    const participants = bodyAs<{ id: string; permissions: string[] }[]>(
      await request(server)
        .get('/api/v1/audits/participants')
        .set(authA)
        .expect(200),
    );
    expect(
      participants.find(({ id }) => id === lead.user.id)?.permissions,
    ).toContain('audits.execute');
    expect(
      participants.find(({ id }) => id === responsible.user.id)?.permissions,
    ).toContain('audits.respond');

    const created = bodyAs<AuditBody>(
      await request(server)
        .post('/api/v1/audits')
        .set(authA)
        .send(planInput(lead.user.id, reviewer.user.id))
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `AUD-${new Date().getUTCFullYear()}-0001`,
      status: 'PLANNED',
    });

    await request(server)
      .get(`/api/v1/audits/${created.id}`)
      .set(authB)
      .expect(404);
    await request(server)
      .post(`/api/v1/audits/${created.id}/start`)
      .set(authA)
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('AUDIT_FORBIDDEN');
      });

    await request(server)
      .post(`/api/v1/audits/${created.id}/start`)
      .set(bearer(lead.accessToken))
      .expect(201)
      .expect(({ body }: { body: AuditBody }) => {
        expect(body.status).toBe('IN_PROGRESS');
      });

    const withFinding = bodyAs<AuditBody>(
      await request(server)
        .post(`/api/v1/audits/${created.id}/findings`)
        .set(bearer(lead.accessToken))
        .send(findingInput(responsible.user.id))
        .expect(201),
    );
    const finding = withFinding.findings[0];
    if (!finding) throw new Error('The audit finding was not created.');
    expect(finding).toMatchObject({
      code: `${created.code}-F01`,
      status: 'OPEN',
    });

    const followingUp = bodyAs<AuditBody>(
      await request(server)
        .post(`/api/v1/audits/${created.id}/report`)
        .set(bearer(lead.accessToken))
        .send(reportInput('Lead auditor passphrase 2026'))
        .expect(201),
    );
    expect(followingUp.status).toBe('FOLLOW_UP');
    expect(followingUp.report?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    await request(server)
      .post(`/api/v1/audits/${created.id}/findings/${finding.id}/responses`)
      .set(bearer(responsible.accessToken))
      .send(responseInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const firstResponse = bodyAs<AuditBody>(
      await request(server)
        .post(`/api/v1/audits/${created.id}/findings/${finding.id}/responses`)
        .set(bearer(responsible.accessToken))
        .send(responseInput('Finding owner passphrase 2026'))
        .expect(201),
    ).findings[0]?.responses[0];
    if (!firstResponse)
      throw new Error('The finding response was not created.');
    expect(firstResponse.responseRecordHash).toMatch(/^[0-9a-f]{64}$/);

    const revision = bodyAs<AuditBody>(
      await request(server)
        .post(
          `/api/v1/audits/${created.id}/findings/${finding.id}/responses/${firstResponse.id}/review`,
        )
        .set(bearer(reviewer.accessToken))
        .send(reviewInput('REQUEST_REVISION', 'Audit reviewer passphrase 2026'))
        .expect(201),
    );
    expect(revision.findings[0]).toMatchObject({ status: 'OPEN' });
    expect(revision.findings[0]?.responses[0]).toMatchObject({
      decision: 'REQUEST_REVISION',
    });
    expect(revision.findings[0]?.responses[0]?.reviewRecordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const second = bodyAs<AuditBody>(
      await request(server)
        .post(`/api/v1/audits/${created.id}/findings/${finding.id}/responses`)
        .set(bearer(responsible.accessToken))
        .send(responseInput('Finding owner passphrase 2026'))
        .expect(201),
    ).findings[0]?.responses[1];
    if (!second)
      throw new Error('The revised finding response was not created.');
    expect(second.attemptNumber).toBe(2);

    const ready = bodyAs<AuditBody>(
      await request(server)
        .post(
          `/api/v1/audits/${created.id}/findings/${finding.id}/responses/${second.id}/review`,
        )
        .set(bearer(reviewer.accessToken))
        .send(reviewInput('ACCEPT', 'Audit reviewer passphrase 2026'))
        .expect(201),
    );
    expect(ready).toMatchObject({ status: 'READY_FOR_CLOSURE' });
    expect(ready.findings[0]).toMatchObject({ status: 'CLOSED' });

    const closed = bodyAs<AuditBody>(
      await request(server)
        .post(`/api/v1/audits/${created.id}/closure`)
        .set(bearer(reviewer.accessToken))
        .send({
          conclusion:
            'The report and both response attempts were reviewed; the accepted action resolves the finding.',
          password: 'Audit reviewer passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(closed.status).toBe('CLOSED');
    expect(closed.closure?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'GMP_AUDIT_PLANNED',
        'GMP_AUDIT_STARTED',
        'GMP_AUDIT_FINDING_RECORDED',
        'GMP_AUDIT_REPORT_COMPLETED',
        'GMP_AUDIT_RESPONSE_REAUTHENTICATION_FAILED',
        'GMP_AUDIT_FINDING_RESPONSE_SUBMITTED',
        'GMP_AUDIT_FINDING_RESPONSE_REVIEWED',
        'GMP_AUDIT_CLOSED',
      ]),
    );
  }, 120_000);
});

function planInput(leadAuditorUserId: string, reviewerUserId: string) {
  return {
    title: 'Internal audit of warehouse temperature controls',
    type: 'INTERNAL',
    scope:
      'Receipt, storage, alarm handling, excursion assessment, and controlled temperature records.',
    objectives:
      'Verify that warehouse controls remain implemented, attributable, and effective.',
    criteria: 'SOP-WH-004, EU GMP Chapter 3, and approved validation protocol.',
    scheduledStartAt: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    scheduledEndAt: new Date(
      Date.now() + 8 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    leadAuditorUserId,
    reviewerUserId,
  };
}

function findingInput(responsibleUserId: string) {
  return {
    classification: 'MAJOR',
    title: 'Alarm acknowledgement evidence is incomplete',
    description:
      'Three sampled alarm records did not include attributable acknowledgement evidence within the required response window.',
    requirementReference: 'SOP-WH-004 section 7.3',
    responsibleUserId,
    responseDueAt: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function reportInput(password: string) {
  return {
    summary:
      'The approved scope was completed using interviews, record sampling, and direct observation of alarm handling.',
    conclusion:
      'One major finding requires a documented root cause, correction, corrective action, and independent review.',
    password,
    attestationAccepted: true,
  };
}

function responseInput(password: string) {
  return {
    response:
      'The sampled records were reconstructed from attributable system logs and the process gap was contained.',
    rootCause:
      'The local work instruction did not clearly identify the electronic acknowledgement as the required record.',
    correction:
      'Supervisors reviewed all open alarm acknowledgements and documented the affected records.',
    correctiveAction:
      'Revise the work instruction, train warehouse staff, and monitor acknowledgement completeness weekly.',
    evidenceReference:
      'Controlled training report TR-2026-014 and monitoring record WH-MON-2026-08.',
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
        ? 'The evidence demonstrates implementation and addresses the identified root cause.'
        : 'Add objective monitoring evidence demonstrating that the revised instruction is consistently followed.',
    password,
    attestationAccepted: true,
  };
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
        tenantName: `Audit ${slug}`,
        tenantSlug: slug,
        adminName: 'Audit Administrator',
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

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

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

interface AuthenticationBody {
  accessToken: string;
  user: { id: string; email: string };
}

interface RoleBody {
  id: string;
  name: string;
  permissions: { code: string }[];
}

interface DeviationBody {
  id: string;
  code: string;
  status: string;
  severity: string | null;
  dueState: string;
  reportedBy: { id: string };
  investigator: { id: string } | null;
  investigationDueAt: string | null;
  requiresCapa?: boolean | null;
  investigationCompletedAt?: string | null;
  description?: string;
  impactAssessment?: string | null;
  containmentAction?: string | null;
  cancellationReason?: string | null;
  investigation?: {
    method: string;
    rootCause: string;
    requiresCapa: boolean;
    completedBy: { id: string };
    meaning: string;
    authenticationMethod: string;
    recordHash: string;
  } | null;
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

describeDatabase('Deviation intake and triage', () => {
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
  });

  it('creates concurrent reports and allows exactly one controlled triage', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `deviation-a-${suffix}`);
    const tenantB = await registerCompany(server, `deviation-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const authB = bearer(tenantB.accessToken);

    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaManager = requiredRole(roles, 'QA Manager');
    const controllerRole = requiredRole(roles, 'Document Controller');
    const operatorRole = requiredRole(roles, 'Operator');
    expect(qaManager.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'deviations.read',
        'deviations.create',
        'deviations.triage',
        'deviations.investigate',
      ]),
    );
    expect(operatorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['deviations.read', 'deviations.create']),
    );
    expect(controllerRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['deviations.read', 'deviations.investigate']),
    );

    const reporter = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `deviation-reporter-${suffix}@example.test`,
      'Deviation Reporter',
      'Deviation reporter passphrase 2026',
    );
    const investigator = await inviteAndAccept(
      server,
      authA,
      notifier,
      controllerRole.id,
      `deviation-investigator-${suffix}@example.test`,
      'Deviation Investigator',
      'Deviation investigator passphrase 2026',
    );

    await request(server)
      .post('/api/v1/deviations')
      .set(bearer(reporter.accessToken))
      .send(reportInput(new Date(Date.now() + 60_000).toISOString(), 'Future'))
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DEVIATION_INVALID');
      });

    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    const reportResponses = await Promise.all([
      request(server)
        .post('/api/v1/deviations')
        .set(bearer(reporter.accessToken))
        .send(reportInput(occurredAt, 'Temperature')),
      request(server)
        .post('/api/v1/deviations')
        .set(bearer(reporter.accessToken))
        .send(reportInput(occurredAt, 'Pressure')),
    ]);
    expect(reportResponses.map(({ status }) => status)).toEqual([201, 201]);
    const reports = reportResponses.map(bodyAs<DeviationBody>);
    const codes = reports.map(({ code }) => code).sort();
    const currentYear = new Date().getUTCFullYear();
    expect(codes).toEqual([
      `DEV-${currentYear}-0001`,
      `DEV-${currentYear}-0002`,
    ]);
    expect(reports[0]).toMatchObject({
      status: 'REPORTED',
      severity: null,
      dueState: 'NOT_APPLICABLE',
      reportedBy: { id: reporter.user.id },
    });

    const first = reports[0];
    const second = reports[1];
    if (!first || !second)
      throw new Error('Deviation reports were not created.');

    await request(server)
      .post(`/api/v1/deviations/${first.id}/triage`)
      .set(bearer(reporter.accessToken))
      .send(triageInput(investigator.user.id))
      .expect(403);
    await request(server)
      .post(`/api/v1/deviations/${first.id}/triage`)
      .set(authA)
      .send({
        ...triageInput(investigator.user.id),
        investigationDueAt: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(400);
    await request(server)
      .post(`/api/v1/deviations/${first.id}/triage`)
      .set(authA)
      .send(triageInput(tenantB.user.id))
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DEVIATION_INVALID');
      });

    const triages = await Promise.all([
      request(server)
        .post(`/api/v1/deviations/${first.id}/triage`)
        .set(authA)
        .send(triageInput(investigator.user.id)),
      request(server)
        .post(`/api/v1/deviations/${first.id}/triage`)
        .set(authA)
        .send(triageInput(investigator.user.id)),
    ]);
    expect(triages.map(({ status }) => status).sort()).toEqual([201, 409]);
    const successfulTriage = triages.find(({ status }) => status === 201);
    if (!successfulTriage) throw new Error('Deviation was not triaged.');
    expect(bodyAs<DeviationBody>(successfulTriage)).toMatchObject({
      status: 'UNDER_INVESTIGATION',
      severity: 'MAJOR',
      dueState: 'ON_TRACK',
      investigator: { id: investigator.user.id },
      impactAssessment: 'Potential impact is limited to the staged material.',
      containmentAction: 'The affected material was segregated and labelled.',
    });

    await request(server)
      .post(`/api/v1/deviations/${first.id}/cancel`)
      .set(authA)
      .send({ reason: 'Triaged evidence cannot be cancelled.' })
      .expect(409);

    await request(server)
      .post(`/api/v1/deviations/${first.id}/investigation/complete`)
      .set(bearer(reporter.accessToken))
      .send(investigationInput('Deviation reporter passphrase 2026'))
      .expect(403);
    await request(server)
      .post(`/api/v1/deviations/${first.id}/investigation/complete`)
      .set(authA)
      .send(investigationInput('Administration passphrase! 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DEVIATION_INVESTIGATION_FORBIDDEN');
      });
    await request(server)
      .post(`/api/v1/deviations/${first.id}/investigation/complete`)
      .set(bearer(investigator.accessToken))
      .send(investigationInput('Incorrect investigator password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const completions = await Promise.all([
      request(server)
        .post(`/api/v1/deviations/${first.id}/investigation/complete`)
        .set(bearer(investigator.accessToken))
        .send(investigationInput('Deviation investigator passphrase 2026')),
      request(server)
        .post(`/api/v1/deviations/${first.id}/investigation/complete`)
        .set(bearer(investigator.accessToken))
        .send(investigationInput('Deviation investigator passphrase 2026')),
    ]);
    expect(completions.map(({ status }) => status).sort()).toEqual([201, 409]);
    const successfulCompletion = completions.find(
      ({ status }) => status === 201,
    );
    if (!successfulCompletion)
      throw new Error('Deviation investigation was not completed.');
    const completed = bodyAs<DeviationBody>(successfulCompletion);
    expect(completed).toMatchObject({
      status: 'INVESTIGATION_COMPLETED',
      dueState: 'COMPLETED',
      requiresCapa: true,
      investigator: { id: investigator.user.id },
      investigation: {
        method: 'FIVE_WHYS',
        rootCause:
          'Preventive maintenance did not include relay degradation checks.',
        requiresCapa: true,
        completedBy: { id: investigator.user.id },
        meaning: 'INVESTIGATION_COMPLETION',
        authenticationMethod: 'PASSWORD_REAUTHENTICATION',
      },
    });
    expect(completed.investigation?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    await request(server)
      .post(`/api/v1/deviations/${second.id}/cancel`)
      .set(bearer(reporter.accessToken))
      .send({ reason: 'Reporter cannot cancel the controlled intake.' })
      .expect(403);
    const cancelled = bodyAs<DeviationBody>(
      await request(server)
        .post(`/api/v1/deviations/${second.id}/cancel`)
        .set(authA)
        .send({ reason: 'Confirmed duplicate of the first report.' })
        .expect(201),
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Confirmed duplicate of the first report.',
    });

    const listed = bodyAs<DeviationBody[]>(
      await request(server)
        .get('/api/v1/deviations?search=temperature')
        .set(bearer(reporter.accessToken))
        .expect(200),
    );
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('impactAssessment');
    expect(JSON.stringify(listed)).not.toContain('rootCause');
    await request(server)
      .get('/api/v1/deviations')
      .set(authB)
      .expect(200)
      .expect([]);

    const detail = bodyAs<DeviationBody>(
      await request(server)
        .get(`/api/v1/deviations/${first.id}`)
        .set(bearer(investigator.accessToken))
        .expect(200),
    );
    expect(detail.description).toContain('Temperature');
    expect(detail.investigation?.rootCause).toContain('relay degradation');

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'DEVIATION_REPORTED',
        'DEVIATION_TRIAGED',
        'DEVIATION_CANCELLED',
        'DEVIATION_INVESTIGATION_REAUTHENTICATION_FAILED',
        'DEVIATION_INVESTIGATION_COMPLETED',
      ]),
    );
  }, 120_000);
});

function reportInput(occurredAt: string, marker: string) {
  return {
    title: `${marker} excursion during material staging`,
    description: `${marker} exceeded the approved operating limit during material staging.`,
    area: 'Warehouse',
    occurredAt,
  };
}

function triageInput(investigatorUserId: string) {
  return {
    severity: 'MAJOR',
    investigatorUserId,
    investigationDueAt: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    impactAssessment: 'Potential impact is limited to the staged material.',
    containmentAction: 'The affected material was segregated and labelled.',
  };
}

function investigationInput(password: string) {
  return {
    method: 'FIVE_WHYS',
    problemStatement: 'The warehouse temperature exceeded its approved limit.',
    chronology:
      '08:00 material staged; 08:10 alarm recorded; 08:20 material segregated.',
    immediateCause: 'The cooling unit stopped after a protection relay opened.',
    rootCause:
      'Preventive maintenance did not include relay degradation checks.',
    contributingFactors:
      'Alarm escalation instructions were not available at the staging point.',
    productImpact:
      'Stability data support the recorded duration and temperature range.',
    requiresCapa: true,
    capaRationale:
      'A CAPA is required to revise maintenance and alarm escalation controls.',
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
        tenantName: `Deviation ${slug}`,
        tenantSlug: slug,
        adminName: 'Deviation Administrator',
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

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
}

interface CapaBody {
  id: string;
  code: string;
  status: string;
  dueState: string;
  actionCount: number;
  completedActionCount: number;
  deviation: { id: string; code: string };
  rootCause?: string;
  actions?: {
    id: string;
    status: string;
    assignedTo: { id: string };
    meaning: string | null;
    authenticationMethod: string | null;
    recordHash: string | null;
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

describeDatabase('CAPA planning and action execution', () => {
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

  it('creates one immutable plan and authenticates each assigned action', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `capa-a-${suffix}`);
    const tenantB = await registerCompany(server, `capa-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const authB = bearer(tenantB.accessToken);

    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const controllerRole = requiredRole(roles, 'Document Controller');
    const operatorRole = requiredRole(roles, 'Operator');
    expect(
      requiredRole(roles, 'QA Manager').permissions.map(({ code }) => code),
    ).toEqual(
      expect.arrayContaining(['capas.read', 'capas.create', 'capas.execute']),
    );
    expect(controllerRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['capas.read', 'capas.execute']),
    );
    expect(operatorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['capas.read', 'capas.execute']),
    );

    const investigator = await inviteAndAccept(
      server,
      authA,
      notifier,
      controllerRole.id,
      `capa-investigator-${suffix}@example.test`,
      'CAPA Investigator',
      'CAPA investigator passphrase 2026',
    );
    const operator = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `capa-operator-${suffix}@example.test`,
      'CAPA Operator',
      'CAPA operator passphrase 2026',
    );

    const deviation = bodyAs<DeviationBody>(
      await request(server)
        .post('/api/v1/deviations')
        .set(authA)
        .send({
          title: 'Cooling relay repeat failure',
          description:
            'A cooling protection relay opened during controlled material staging.',
          area: 'Warehouse',
          occurredAt: new Date(Date.now() - 60_000).toISOString(),
        })
        .expect(201),
    );
    await request(server)
      .post(`/api/v1/deviations/${deviation.id}/triage`)
      .set(authA)
      .send({
        severity: 'CRITICAL',
        investigatorUserId: investigator.user.id,
        investigationDueAt: futureDate(30),
        impactAssessment: 'The staged material requires documented assessment.',
        containmentAction: 'Material was segregated and the relay isolated.',
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/deviations/${deviation.id}/investigation/complete`)
      .set(bearer(investigator.accessToken))
      .send({
        method: 'FIVE_WHYS',
        problemStatement: 'The cooling relay opened during material staging.',
        chronology: 'Alarm recorded, material isolated and relay inspected.',
        immediateCause:
          'The protection relay opened after thermal degradation.',
        rootCause: 'Preventive maintenance omitted relay degradation checks.',
        contributingFactors:
          'Escalation instructions were not at point of use.',
        productImpact:
          'Stability evidence supports disposition of the material.',
        requiresCapa: true,
        capaRationale:
          'Maintenance and escalation controls require improvement.',
        password: 'CAPA investigator passphrase 2026',
        attestationAccepted: true,
      })
      .expect(201);

    const invalidInput = planInput(
      deviation.id,
      investigator.user.id,
      operator.user.id,
    );
    invalidInput.actions[0].dueAt = new Date(Date.now() - 60_000).toISOString();
    await request(server)
      .post('/api/v1/capas')
      .set(authA)
      .send(invalidInput)
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CAPA_INVALID');
      });
    await request(server)
      .post('/api/v1/capas')
      .set(authA)
      .send(planInput(tenantB.user.id, investigator.user.id, operator.user.id))
      .expect(400);

    const creates = await Promise.all([
      request(server)
        .post('/api/v1/capas')
        .set(authA)
        .send(planInput(deviation.id, investigator.user.id, operator.user.id)),
      request(server)
        .post('/api/v1/capas')
        .set(authA)
        .send(planInput(deviation.id, investigator.user.id, operator.user.id)),
    ]);
    expect(creates.map(({ status }) => status).sort()).toEqual([201, 409]);
    const createdResponse = creates.find(({ status }) => status === 201);
    if (!createdResponse) throw new Error('CAPA plan was not created.');
    const created = bodyAs<CapaBody>(createdResponse);
    expect(created).toMatchObject({
      code: `CAPA-${new Date().getUTCFullYear()}-0001`,
      status: 'OPEN',
      dueState: 'ON_TRACK',
      actionCount: 2,
      completedActionCount: 0,
      deviation: { id: deviation.id },
    });
    expect(created.rootCause).toContain('relay degradation checks');
    const investigatorAction = created.actions?.find(
      ({ assignedTo }) => assignedTo.id === investigator.user.id,
    );
    const operatorAction = created.actions?.find(
      ({ assignedTo }) => assignedTo.id === operator.user.id,
    );
    if (!investigatorAction || !operatorAction) {
      throw new Error('CAPA actions were not created.');
    }

    await request(server)
      .post(
        `/api/v1/capas/${created.id}/actions/${investigatorAction.id}/complete`,
      )
      .set(authA)
      .send(completionInput('Administration passphrase! 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CAPA_ACTION_FORBIDDEN');
      });
    await request(server)
      .post(
        `/api/v1/capas/${created.id}/actions/${investigatorAction.id}/complete`,
      )
      .set(bearer(investigator.accessToken))
      .send(completionInput('Incorrect password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const completions = await Promise.all([
      request(server)
        .post(
          `/api/v1/capas/${created.id}/actions/${investigatorAction.id}/complete`,
        )
        .set(bearer(investigator.accessToken))
        .send(completionInput('CAPA investigator passphrase 2026')),
      request(server)
        .post(
          `/api/v1/capas/${created.id}/actions/${investigatorAction.id}/complete`,
        )
        .set(bearer(investigator.accessToken))
        .send(completionInput('CAPA investigator passphrase 2026')),
    ]);
    expect(completions.map(({ status }) => status).sort()).toEqual([201, 409]);
    const firstCompletion = completions.find(({ status }) => status === 201);
    if (!firstCompletion) throw new Error('CAPA action was not completed.');
    const inProgress = bodyAs<CapaBody>(firstCompletion);
    expect(inProgress).toMatchObject({
      status: 'IN_PROGRESS',
      completedActionCount: 1,
    });
    const completedEvidence = inProgress.actions?.find(
      ({ id }) => id === investigatorAction.id,
    );
    expect(completedEvidence).toMatchObject({
      status: 'COMPLETED',
      meaning: 'ACTION_COMPLETION',
      authenticationMethod: 'PASSWORD_REAUTHENTICATION',
    });
    expect(completedEvidence?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    const implemented = bodyAs<CapaBody>(
      await request(server)
        .post(
          `/api/v1/capas/${created.id}/actions/${operatorAction.id}/complete`,
        )
        .set(bearer(operator.accessToken))
        .send(completionInput('CAPA operator passphrase 2026'))
        .expect(201),
    );
    expect(implemented).toMatchObject({
      status: 'IMPLEMENTATION_COMPLETED',
      dueState: 'COMPLETED',
      completedActionCount: 2,
    });

    const listed = bodyAs<CapaBody[]>(
      await request(server)
        .get('/api/v1/capas?search=relay')
        .set(bearer(operator.accessToken))
        .expect(200),
    );
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('rootCause');
    expect(JSON.stringify(listed)).not.toContain('recordHash');
    await request(server)
      .get('/api/v1/capas')
      .set(authB)
      .expect(200)
      .expect([]);

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'CAPA_PLAN_CREATED',
        'CAPA_ACTION_REAUTHENTICATION_FAILED',
        'CAPA_ACTION_COMPLETED',
      ]),
    );
  }, 120_000);
});

function planInput(
  deviationId: string,
  investigatorUserId: string,
  operatorUserId: string,
) {
  return {
    deviationId,
    title: 'Warehouse cooling reliability improvement',
    objective:
      'Prevent recurrence of controlled staging temperature excursions.',
    actions: [
      {
        type: 'CORRECTIVE',
        title: 'Revise the maintenance checklist',
        description:
          'Add relay degradation checks and objective acceptance criteria.',
        assignedToUserId: investigatorUserId,
        dueAt: futureDate(20),
      },
      {
        type: 'PREVENTIVE',
        title: 'Deploy escalation instructions',
        description:
          'Train warehouse staff and place controlled instructions at point of use.',
        assignedToUserId: operatorUserId,
        dueAt: futureDate(30),
      },
    ],
  };
}

function completionInput(password: string) {
  return {
    comment:
      'Implementation evidence was reviewed and the action was completed.',
    password,
    attestationAccepted: true,
  };
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
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
        tenantName: `CAPA ${slug}`,
        tenantSlug: slug,
        adminName: 'CAPA Administrator',
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

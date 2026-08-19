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
interface RiskBody {
  id: string;
  code: string;
  status: string;
  highestInitialRpn: number;
  highestResidualRpn: number | null;
  items: {
    id: string;
    status: string;
    initialRpn: number;
    residualRpn: number | null;
    recordHash: string | null;
  }[];
  review: { decision: string; recordHash: string } | null;
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

describeDatabase('quality risk management lifecycle', () => {
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

  it('isolates tenants and preserves signed mitigation and independent review evidence', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `risk-a-${suffix}`);
    const tenantB = await registerCompany(server, `risk-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaRole = requiredRole(roles, 'QA Manager');
    const operatorRole = requiredRole(roles, 'Operator');
    expect(qaRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'risks.read',
        'risks.create',
        'risks.mitigate',
        'risks.review',
      ]),
    );

    const reviewer = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `risk-reviewer-${suffix}@example.test`,
      'Risk Reviewer',
      'Risk reviewer passphrase 2026',
    );
    const mitigator = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `risk-mitigator-${suffix}@example.test`,
      'Risk Mitigator',
      'Risk mitigator passphrase 2026',
    );

    const participants = bodyAs<{ id: string; permissions: string[] }[]>(
      await request(server)
        .get('/api/v1/quality-risks/participants')
        .set(authA)
        .expect(200),
    );
    expect(
      participants.find(({ id }) => id === reviewer.user.id)?.permissions,
    ).toContain('risks.review');
    expect(
      participants.find(({ id }) => id === mitigator.user.id)?.permissions,
    ).toContain('risks.mitigate');

    const created = bodyAs<RiskBody>(
      await request(server)
        .post('/api/v1/quality-risks')
        .set(authA)
        .send(riskInput(tenantA.user.id, reviewer.user.id, mitigator.user.id))
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `QRM-${new Date().getUTCFullYear()}-0001`,
      status: 'OPEN',
      highestInitialRpn: 100,
    });

    await request(server)
      .get(`/api/v1/quality-risks/${created.id}`)
      .set(bearer(tenantB.accessToken))
      .expect(404);

    const item = created.items[0];
    if (!item) throw new Error('The FMEA item was not created.');
    await request(server)
      .post(`/api/v1/quality-risks/${created.id}/items/${item.id}/complete`)
      .set(bearer(mitigator.accessToken))
      .send(completionInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const pendingReview = bodyAs<RiskBody>(
      await request(server)
        .post(`/api/v1/quality-risks/${created.id}/items/${item.id}/complete`)
        .set(bearer(mitigator.accessToken))
        .send(completionInput('Risk mitigator passphrase 2026'))
        .expect(201),
    );
    expect(pendingReview).toMatchObject({
      status: 'PENDING_REVIEW',
      highestResidualRpn: 12,
    });
    expect(pendingReview.items[0]?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    await request(server)
      .post(`/api/v1/quality-risks/${created.id}/review`)
      .set(authA)
      .send(reviewInput('Administration passphrase! 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('QUALITY_RISK_FORBIDDEN');
      });

    const closed = bodyAs<RiskBody>(
      await request(server)
        .post(`/api/v1/quality-risks/${created.id}/review`)
        .set(bearer(reviewer.accessToken))
        .send(reviewInput('Risk reviewer passphrase 2026'))
        .expect(201),
    );
    expect(closed.status).toBe('CLOSED');
    expect(closed.review).toMatchObject({ decision: 'ACCEPT' });
    expect(closed.review?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'QUALITY_RISK_ASSESSMENT_CREATED',
        'QUALITY_RISK_MITIGATION_REAUTHENTICATION_FAILED',
        'QUALITY_RISK_MITIGATION_COMPLETED',
        'QUALITY_RISK_RESIDUAL_REVIEW_COMPLETED',
      ]),
    );
  }, 120_000);
});

function riskInput(
  ownerUserId: string,
  reviewerUserId: string,
  assignedToUserId: string,
) {
  return {
    title: 'Temperature excursion during cold-room transfer',
    category: 'PROCESS',
    processArea: 'Warehouse cold chain',
    scope:
      'Transfer of temperature-sensitive material between receipt and qualified cold-room storage.',
    riskStatement:
      'Material quality could be affected if transfer duration exceeds the qualified exposure window.',
    ownerUserId,
    reviewerUserId,
    targetReviewAt: new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    items: [
      {
        failureMode: 'Transfer remains outside qualified storage too long',
        cause: 'The receiving alarm is not escalated to a backup operator.',
        effect: 'Material potency may fall outside the approved specification.',
        currentControls:
          'Qualified shipping container, transfer timer, and temperature logger.',
        initialSeverity: 5,
        initialProbability: 4,
        initialDetectability: 5,
        mitigationPlan:
          'Configure timed escalation and verify the backup operator response drill.',
        assignedToUserId,
        dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };
}

function completionInput(password: string) {
  return {
    completionEvidence:
      'Escalation configuration CC-2026-017 and successful drill record WH-DRILL-042 were reviewed.',
    residualSeverity: 4,
    residualProbability: 1,
    residualDetectability: 3,
    password,
    attestationAccepted: true,
  };
}

function reviewInput(password: string) {
  return {
    decision: 'ACCEPT',
    rationale:
      'The implemented escalation and objective drill evidence reduce the residual RPN to an acceptable level.',
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
        tenantName: `Risk ${slug}`,
        tenantSlug: slug,
        adminName: 'Risk Administrator',
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

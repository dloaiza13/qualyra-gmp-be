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
import { TenantUnitOfWork } from '../src/modules/tenancy/application/ports/tenant-unit-of-work.js';

const describeDatabase =
  process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

interface AuthenticationBody {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string };
}
interface RoleBody {
  id: string;
  name: string;
  permissions: { code: string }[];
}
interface ChangeControlBody {
  id: string;
  code: string;
  status: string;
  riskLevel: string | null;
  openTaskCount: number;
  totalTaskCount: number;
  assessment: {
    approver: { id: string };
    verifier: { id: string };
  } | null;
  decision: { decision: string; recordHash: string } | null;
  tasks: { id: string; status: string; recordHash: string | null }[];
  verification: { decision: string; recordHash: string } | null;
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

describeDatabase('GMP change control lifecycle', () => {
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

  it('enforces tenant isolation, segregation, signatures, and controlled closure', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `change-a-${suffix}`);
    const tenantB = await registerCompany(server, `change-b-${suffix}`);
    await app.get(TenantUnitOfWork).execute(tenantA.tenant.id, (transaction) =>
      transaction.tenant.update({
        where: { id: tenantA.tenant.id },
        data: { plan: 'PROFESSIONAL' },
      }),
    );
    const authA = bearer(tenantA.accessToken);
    const authB = bearer(tenantB.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaRole = requiredRole(roles, 'QA Manager');
    const operatorRole = requiredRole(roles, 'Operator');
    expect(qaRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'changes.read',
        'changes.create',
        'changes.assess',
        'changes.approve',
        'changes.implement',
        'changes.verify',
      ]),
    );

    const proposer = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `change-proposer-${suffix}@example.test`,
      'Change Proposer',
      'Change proposer passphrase 2026',
    );
    const assessor = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `change-assessor-${suffix}@example.test`,
      'Change Assessor',
      'Change assessor passphrase 2026',
    );
    const approver = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `change-approver-${suffix}@example.test`,
      'Change Approver',
      'Change approver passphrase 2026',
    );
    const verifier = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `change-verifier-${suffix}@example.test`,
      'Change Verifier',
      'Change verifier passphrase 2026',
    );
    const implementer = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `change-implementer-${suffix}@example.test`,
      'Change Implementer',
      'Change implementer passphrase 2026',
    );

    const participants = bodyAs<{ id: string; permissions: string[] }[]>(
      await request(server)
        .get('/api/v1/change-controls/participants')
        .set(bearer(assessor.accessToken))
        .expect(200),
    );
    expect(
      participants.find(({ id }) => id === approver.user.id)?.permissions,
    ).toContain('changes.approve');
    expect(
      participants.find(({ id }) => id === implementer.user.id)?.permissions,
    ).toContain('changes.implement');

    const created = bodyAs<ChangeControlBody>(
      await request(server)
        .post('/api/v1/change-controls')
        .set(bearer(proposer.accessToken))
        .send(proposalInput())
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `CC-${new Date().getUTCFullYear()}-0001`,
      status: 'PROPOSED',
      riskLevel: null,
    });

    await request(server)
      .get(`/api/v1/change-controls/${created.id}`)
      .set(authB)
      .expect(404);

    await request(server)
      .post(`/api/v1/change-controls/${created.id}/assessment`)
      .set(bearer(assessor.accessToken))
      .send(
        assessmentInput(
          implementer.user.id,
          proposer.user.id,
          verifier.user.id,
        ),
      )
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CHANGE_CONTROL_INVALID');
      });

    const assessed = bodyAs<ChangeControlBody>(
      await request(server)
        .post(`/api/v1/change-controls/${created.id}/assessment`)
        .set(bearer(assessor.accessToken))
        .send(
          assessmentInput(
            implementer.user.id,
            approver.user.id,
            verifier.user.id,
          ),
        )
        .expect(201),
    );
    expect(assessed).toMatchObject({
      status: 'ASSESSED',
      riskLevel: 'HIGH',
      openTaskCount: 1,
      totalTaskCount: 1,
      assessment: {
        approver: { id: approver.user.id },
        verifier: { id: verifier.user.id },
      },
    });

    await request(server)
      .post(`/api/v1/change-controls/${created.id}/decision`)
      .set(bearer(assessor.accessToken))
      .send(decisionInput('Change assessor passphrase 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CHANGE_CONTROL_FORBIDDEN');
      });
    await request(server)
      .post(`/api/v1/change-controls/${created.id}/decision`)
      .set(bearer(approver.accessToken))
      .send(decisionInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const approved = bodyAs<ChangeControlBody>(
      await request(server)
        .post(`/api/v1/change-controls/${created.id}/decision`)
        .set(bearer(approver.accessToken))
        .send(decisionInput('Change approver passphrase 2026'))
        .expect(201),
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.decision).toMatchObject({ decision: 'APPROVE' });
    expect(approved.decision?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    const task = approved.tasks[0];
    if (!task) throw new Error('The implementation task was not created.');

    const pendingVerification = bodyAs<ChangeControlBody>(
      await request(server)
        .post(`/api/v1/change-controls/${created.id}/tasks/${task.id}/complete`)
        .set(bearer(implementer.accessToken))
        .send({
          comment: 'The validated configuration was deployed and documented.',
          password: 'Change implementer passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(pendingVerification).toMatchObject({
      status: 'PENDING_VERIFICATION',
      openTaskCount: 0,
    });
    expect(pendingVerification.tasks[0]?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    await request(server)
      .post(`/api/v1/change-controls/${created.id}/verification`)
      .set(bearer(approver.accessToken))
      .send(verificationInput('Change approver passphrase 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CHANGE_CONTROL_FORBIDDEN');
      });

    const closed = bodyAs<ChangeControlBody>(
      await request(server)
        .post(`/api/v1/change-controls/${created.id}/verification`)
        .set(bearer(verifier.accessToken))
        .send(verificationInput('Change verifier passphrase 2026'))
        .expect(201),
    );
    expect(closed.status).toBe('CLOSED');
    expect(closed.verification).toMatchObject({ decision: 'EFFECTIVE' });
    expect(closed.verification?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'CHANGE_CONTROL_PROPOSED',
        'CHANGE_CONTROL_ASSESSED',
        'CHANGE_CONTROL_APPROVAL_REAUTHENTICATION_FAILED',
        'CHANGE_CONTROL_APPROVAL_DECIDED',
        'CHANGE_CONTROL_TASK_COMPLETED',
        'CHANGE_CONTROL_VERIFICATION_COMPLETED',
      ]),
    );
  }, 120_000);
});

function proposalInput() {
  return {
    title: 'Introduce validated electronic temperature monitoring',
    description:
      'Replace the manual monitoring log with validated electronic monitoring in the warehouse.',
    justification:
      'The change reduces transcription risk and improves timely alarm escalation.',
    category: 'SOFTWARE',
    targetCompletionAt: new Date(
      Date.now() + 45 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function assessmentInput(
  ownerUserId: string,
  approverUserId: string,
  verifierUserId: string,
) {
  return {
    impactSummary:
      'The validated monitoring process affects warehouse quality records and alarm response.',
    qualityImpact:
      'Electronic records become the authoritative temperature evidence.',
    regulatoryImpact:
      'Electronic records must retain attributable audit trails.',
    validationImpact:
      'The configured software and alarm paths require validation.',
    trainingImpact:
      'Warehouse personnel require role-based operating training.',
    documentImpact:
      'The monitoring SOP and alarm response form require revision.',
    riskLevel: 'HIGH',
    riskRationale:
      'A missed alarm could affect material disposition, requiring strong preventive controls.',
    implementationPlan:
      'Validate configuration, revise procedures, train users, and deploy under an approved protocol.',
    rollbackPlan:
      'Restore the controlled manual log and disable electronic record release if acceptance fails.',
    ownerUserId,
    approverUserId,
    verifierUserId,
    verificationCriterion:
      'No missed alarms and complete attributable records during the first controlled review period.',
    tasks: [
      {
        title: 'Deploy validated monitoring configuration',
        description:
          'Execute the approved protocol and record the production configuration evidence.',
        assignedToUserId: ownerUserId,
        dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
  };
}

function decisionInput(password: string) {
  return {
    decision: 'APPROVE',
    comment: 'The impact assessment and mitigation plan are acceptable.',
    password,
    attestationAccepted: true,
  };
}

function verificationInput(password: string) {
  return {
    decision: 'EFFECTIVE',
    evidence:
      'The controlled review period recorded all challenges, alarms, and acknowledgements without gaps.',
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
        tenantName: `Change control ${slug}`,
        tenantSlug: slug,
        adminName: 'Change Control Administrator',
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

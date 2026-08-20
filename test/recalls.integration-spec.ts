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
interface RecallBody {
  id: string;
  code: string;
  status: string;
  dueState: string;
  recoveredUnits: number;
  recoveryRate: number;
  riskAssessment: { recordHash: string; assessedBy: { id: string } } | null;
  decision: { recordHash: string; decidedBy: { id: string } } | null;
  executionUpdates: { sequenceNumber: number }[];
  closure: { recordHash: string; closedBy: { id: string } } | null;
  cancellationReason: string | null;
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

describeDatabase('product recall and field-action lifecycle', () => {
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

  it('isolates field actions and preserves independent signed assessment, decision, execution, and closure evidence', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `recall-a-${suffix}`);
    const tenantB = await registerCompany(server, `recall-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const operatorRole = requiredRole(roles, 'Operator');
    const auditorRole = requiredRole(roles, 'Auditor');
    expect(operatorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'recalls.read',
        'recalls.create',
        'recalls.execute',
      ]),
    );
    expect(auditorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'recalls.read',
        'recalls.approve',
        'recalls.close',
      ]),
    );
    const executor = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `recall-executor-${suffix}@example.test`,
      'Recall Executor',
      'Recall executor passphrase 2026',
    );
    const approver = await inviteAndAccept(
      server,
      authA,
      notifier,
      auditorRole.id,
      `recall-approver-${suffix}@example.test`,
      'Recall Approver',
      'Recall approver passphrase 2026',
    );

    const created = bodyAs<RecallBody>(
      await request(server)
        .post('/api/v1/recalls')
        .set(authA)
        .send(recallInput())
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `RCL-${new Date().getUTCFullYear()}-0001`,
      status: 'REPORTED',
      dueState: 'ON_TRACK',
      recoveredUnits: 0,
    });
    await request(server)
      .get(`/api/v1/recalls/${created.id}`)
      .set(bearer(tenantB.accessToken))
      .expect(404);

    await request(server)
      .post(`/api/v1/recalls/${created.id}/assessment`)
      .set(authA)
      .send(assessmentInput(approver.user.id, 'wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });
    const assessed = bodyAs<RecallBody>(
      await request(server)
        .post(`/api/v1/recalls/${created.id}/assessment`)
        .set(authA)
        .send(
          assessmentInput(approver.user.id, 'Administration passphrase! 2026'),
        )
        .expect(201),
    );
    expect(assessed.status).toBe('PENDING_APPROVAL');
    expect(assessed.riskAssessment?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(assessed.riskAssessment?.assessedBy.id).toBe(tenantA.user.id);

    const approved = bodyAs<RecallBody>(
      await request(server)
        .post(`/api/v1/recalls/${created.id}/decision`)
        .set(bearer(approver.accessToken))
        .send({
          approved: true,
          rationale:
            'The documented health hazard and distribution trace justify a controlled market recall.',
          authorityReference:
            'Regulatory Affairs case RA-2026-0042; submission remains outside this application.',
          password: 'Recall approver passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.decision?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approved.decision?.decidedBy.id).toBe(approver.user.id);

    const executing = bodyAs<RecallBody>(
      await request(server)
        .post(`/api/v1/recalls/${created.id}/execution-updates`)
        .set(bearer(executor.accessToken))
        .send(executionInput())
        .expect(201),
    );
    expect(executing).toMatchObject({
      status: 'IN_EXECUTION',
      recoveredUnits: 700,
      recoveryRate: 70,
    });
    expect(executing.executionUpdates).toHaveLength(1);

    await request(server)
      .post(`/api/v1/recalls/${created.id}/execution-updates`)
      .set(bearer(executor.accessToken))
      .send({ ...executionInput(), cumulativeRecoveredUnits: 699 })
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('RECALL_INVALID');
      });

    const closed = bodyAs<RecallBody>(
      await request(server)
        .post(`/api/v1/recalls/${created.id}/closure`)
        .set(bearer(approver.accessToken))
        .send({
          effectivenessSummary:
            'All identified accounts were contacted and the effectiveness checks met the approved plan.',
          reconciliationSummary:
            'Nine hundred units were recovered from one thousand distributed units; the remainder is documented by account response.',
          finalNotifiedAccounts: 25,
          finalRespondingAccounts: 25,
          finalRecoveredUnits: 900,
          finalDestroyedUnits: 900,
          dispositionEvidence:
            'Destruction certificate DC-2026-009 and warehouse reconciliation report.',
          regulatoryClosureReference:
            'Regulatory Affairs closure package RA-2026-0042-CLOSE.',
          password: 'Recall approver passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(closed).toMatchObject({
      status: 'CLOSED',
      dueState: 'COMPLETED',
      recoveredUnits: 900,
      recoveryRate: 90,
    });
    expect(closed.closure?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(closed.closure?.closedBy.id).toBe(approver.user.id);

    const cancellable = bodyAs<RecallBody>(
      await request(server)
        .post('/api/v1/recalls')
        .set(authA)
        .send({ ...recallInput(), title: 'Duplicate field action record' })
        .expect(201),
    );
    const cancelled = bodyAs<RecallBody>(
      await request(server)
        .post(`/api/v1/recalls/${cancellable.id}/cancellation`)
        .set(authA)
        .send({
          reason:
            'This record duplicates the approved field-action signal and was created in error.',
        })
        .expect(201),
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      dueState: 'CANCELLED',
    });

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'RECALL_REPORTED',
        'RECALL_ASSESSMENT_REAUTHENTICATION_FAILED',
        'RECALL_RISK_ASSESSMENT_COMPLETED',
        'RECALL_DECIDED',
        'RECALL_EXECUTION_UPDATED',
        'RECALL_CLOSED',
        'RECALL_CANCELLED',
      ]),
    );
  }, 180_000);
});

function recallInput() {
  return {
    title: 'Controlled market recall for sterile solution lot',
    actionType: 'RECALL',
    sourceReference: 'Quality signal PQC-2026-0001 and QA escalation memo',
    productName: 'Sterile solution 10 mL',
    productCode: 'SOL-10',
    lotNumbers: [`LOT-${Date.now()}`],
    countryCodes: ['GT', 'CR'],
    reason:
      'A confirmed particulate defect requires a controlled health-hazard assessment and market action.',
    distributionStartDate: '2026-01-01',
    distributionEndDate: '2026-07-31',
    totalDistributedUnits: 1000,
    targetCloseAt: new Date(
      Date.now() + 45 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function assessmentInput(approverUserId: string, password: string) {
  return {
    classification: 'CLASS_II',
    depth: 'CONSUMER',
    healthHazard:
      'Use of affected units may cause a temporary adverse health consequence that warrants prompt market action.',
    scopeRationale:
      'Distribution mapping and manufacturing review limit the action to the identified lot in two countries.',
    regulatoryReportingRequired: true,
    communicationPlan:
      'Regulatory Affairs will manage authority communication while Quality manages accounts and reconciliation.',
    recommendedAction:
      'Approve a consumer-level recall with account notification, recovery, controlled destruction, and effectiveness checks.',
    approverUserId,
    password,
    attestationAccepted: true,
  };
}

function executionInput() {
  return {
    updateType: 'PRODUCT_RECOVERY',
    note: 'All direct accounts were notified and the first consolidated recovery reconciliation was completed.',
    evidenceReference:
      'Account notification register AN-2026-003 and warehouse recovery report WR-2026-019.',
    cumulativeNotifiedAccounts: 25,
    cumulativeRespondingAccounts: 20,
    cumulativeRecoveredUnits: 700,
    cumulativeDestroyedUnits: 0,
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
        tenantName: `Recall ${slug}`,
        tenantSlug: slug,
        adminName: 'Recall Administrator',
        email: `admin@${slug}.test`,
        password: 'Administration passphrase! 2026',
      })
      .expect(201),
  );
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function bodyAs<T>(response: Response): T {
  return response.body as T;
}

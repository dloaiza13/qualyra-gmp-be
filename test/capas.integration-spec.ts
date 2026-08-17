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
import { CapaMonitoringService } from '../src/modules/capas/application/capa-monitoring.service.js';
import {
  CapaMonitoringNotifier,
  type CapaMonitoringMessage,
} from '../src/modules/capas/domain/ports/capa-monitoring-notifier.js';

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

interface AuthenticationBody {
  accessToken: string;
  user: { id: string; email: string };
  tenant: { id: string; name: string; slug: string };
}

interface RoleBody {
  id: string;
  name: string;
  permissions: { code: string }[];
}

interface DeviationBody {
  id: string;
  status?: string;
  closure?: {
    capaId: string;
    decision: string;
    recordHash: string;
  } | null;
}

interface CapaBody {
  id: string;
  code: string;
  status: string;
  dueState: string;
  actionCount: number;
  completedActionCount: number;
  currentCycleNumber: number;
  followUpCycleCount: number;
  deviation: { id: string; code: string };
  rootCause?: string;
  actions?: {
    id: string;
    status: string;
    assignedTo: { id: string };
    meaning: string | null;
    authenticationMethod: string | null;
    recordHash: string | null;
    followUpCycleNumber: number | null;
    effectiveDueAt: string;
    extensions: { recordHash: string; newDueAt: string }[];
    evidenceReferences: {
      sha256: string;
      storageReference: string;
      managed?: boolean;
      downloadUrl?: string | null;
    }[];
  }[];
  effectivenessReview?: {
    id: string;
    status: string;
    decision: string | null;
    assignedTo: { id: string };
    meaning: string | null;
    authenticationMethod: string | null;
    recordHash: string | null;
    cycleNumber: number;
  } | null;
  effectivenessReviews?: {
    id: string;
    cycleNumber: number;
    decision: string;
  }[];
  followUpCycles?: {
    cycleNumber: number;
    sourceEffectivenessReviewId: string;
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

class RecordingCapaMonitoringNotifier extends CapaMonitoringNotifier {
  readonly messages: CapaMonitoringMessage[] = [];

  send(message: CapaMonitoringMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}

describeDatabase('CAPA planning and action execution', () => {
  const notifier = new RecordingNotifier();
  const monitoringNotifier = new RecordingCapaMonitoringNotifier();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthenticationNotifier)
      .useValue(notifier)
      .overrideProvider(CapaMonitoringNotifier)
      .useValue(monitoringNotifier)
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
    const qaManagerRole = requiredRole(roles, 'QA Manager');
    expect(qaManagerRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'capas.read',
        'capas.create',
        'capas.execute',
        'capas.schedule_effectiveness',
        'capas.verify_effectiveness',
        'capas.create_follow_up',
        'capas.approve_extensions',
      ]),
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
    const reviewer = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaManagerRole.id,
      `capa-reviewer-${suffix}@example.test`,
      'CAPA Effectiveness Reviewer',
      'CAPA reviewer passphrase 2026',
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
    const monitor = app.get(CapaMonitoringService);
    const simulatedEscalationAt = new Date(
      Date.now() + 40 * 24 * 60 * 60 * 1000,
    );
    await monitor.runTenant(tenantA.tenant.id, simulatedEscalationAt);
    const deliveredOnce = monitoringNotifier.messages.length;
    expect(deliveredOnce).toBeGreaterThanOrEqual(2);
    expect(monitoringNotifier.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capaCode: created.code,
          dueState: 'ESCALATED',
          subjectType: 'ACTION',
        }),
      ]),
    );
    await monitor.runTenant(tenantA.tenant.id, simulatedEscalationAt);
    expect(monitoringNotifier.messages).toHaveLength(deliveredOnce);
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

    await request(server)
      .post(`/api/v1/capas/${created.id}/effectiveness-review`)
      .set(authA)
      .send({
        criterion:
          'Verify three consecutive staging cycles without relay alarms or temperature excursions.',
        assignedToUserId: investigator.user.id,
        dueAt: futureDate(45),
      })
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CAPA_INVALID');
      });

    const scheduled = bodyAs<CapaBody>(
      await request(server)
        .post(`/api/v1/capas/${created.id}/effectiveness-review`)
        .set(authA)
        .send({
          criterion:
            'Verify three consecutive staging cycles without relay alarms or temperature excursions.',
          assignedToUserId: reviewer.user.id,
          dueAt: futureDate(45),
        })
        .expect(201),
    );
    expect(scheduled).toMatchObject({
      status: 'EFFECTIVENESS_REVIEW',
      effectivenessReview: {
        status: 'SCHEDULED',
        decision: null,
        assignedTo: { id: reviewer.user.id },
      },
    });

    await request(server)
      .post(`/api/v1/capas/${created.id}/effectiveness-review/complete`)
      .set(authA)
      .send(effectivenessInput('Administration passphrase! 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CAPA_EFFECTIVENESS_FORBIDDEN');
      });
    await request(server)
      .post(`/api/v1/capas/${created.id}/effectiveness-review/complete`)
      .set(bearer(reviewer.accessToken))
      .send(effectivenessInput('Incorrect password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const verifications = await Promise.all([
      request(server)
        .post(`/api/v1/capas/${created.id}/effectiveness-review/complete`)
        .set(bearer(reviewer.accessToken))
        .send(
          effectivenessInput('CAPA reviewer passphrase 2026', 'INEFFECTIVE'),
        ),
      request(server)
        .post(`/api/v1/capas/${created.id}/effectiveness-review/complete`)
        .set(bearer(reviewer.accessToken))
        .send(
          effectivenessInput('CAPA reviewer passphrase 2026', 'INEFFECTIVE'),
        ),
    ]);
    expect(verifications.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    const verifiedResponse = verifications.find(({ status }) => status === 201);
    if (!verifiedResponse) throw new Error('CAPA review was not completed.');
    const verified = bodyAs<CapaBody>(verifiedResponse);
    expect(verified).toMatchObject({
      status: 'INEFFECTIVE',
      dueState: 'COMPLETED',
      currentCycleNumber: 0,
      effectivenessReview: {
        cycleNumber: 0,
        status: 'COMPLETED',
        decision: 'INEFFECTIVE',
        meaning: 'EFFECTIVENESS_VERIFICATION',
        authenticationMethod: 'PASSWORD_REAUTHENTICATION',
      },
    });
    expect(verified.effectivenessReview?.recordHash).toMatch(/^[0-9a-f]{64}$/);

    const stillOpenDeviation = bodyAs<DeviationBody>(
      await request(server)
        .get(`/api/v1/deviations/${deviation.id}`)
        .set(authA)
        .expect(200),
    );
    expect(stillOpenDeviation).toMatchObject({
      status: 'INVESTIGATION_COMPLETED',
      closure: null,
    });

    const followUpInput = {
      rationale:
        'The verification exposed a residual relay degradation mode that requires an additional control.',
      actions: [
        {
          type: 'CORRECTIVE',
          title: 'Add relay load trending',
          description:
            'Trend relay load under representative staging conditions and approve objective limits.',
          assignedToUserId: operator.user.id,
          dueAt: futureDate(20),
        },
      ],
    };
    const followUpCreates = await Promise.all([
      request(server)
        .post(`/api/v1/capas/${created.id}/follow-up-cycles`)
        .set(authA)
        .send(followUpInput),
      request(server)
        .post(`/api/v1/capas/${created.id}/follow-up-cycles`)
        .set(authA)
        .send(followUpInput),
    ]);
    expect(followUpCreates.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    const followUpResponse = followUpCreates.find(
      ({ status }) => status === 201,
    );
    if (!followUpResponse) throw new Error('Follow-up cycle was not created.');
    const followedUp = bodyAs<CapaBody>(followUpResponse);
    expect(followedUp).toMatchObject({
      status: 'FOLLOW_UP_ACTIONS',
      currentCycleNumber: 1,
      followUpCycleCount: 1,
      actionCount: 3,
      completedActionCount: 2,
    });
    expect(followedUp.effectivenessReviews).toHaveLength(1);
    expect(followedUp.followUpCycles).toEqual([
      expect.objectContaining({
        cycleNumber: 1,
        sourceEffectivenessReviewId: verified.effectivenessReview?.id,
      }),
    ]);
    const followUpAction = followedUp.actions?.find(
      ({ followUpCycleNumber }) => followUpCycleNumber === 1,
    );
    if (!followUpAction) throw new Error('Follow-up action was not created.');

    const extended = bodyAs<CapaBody>(
      await request(server)
        .post(
          `/api/v1/capas/${created.id}/actions/${followUpAction.id}/extensions`,
        )
        .set(authA)
        .send({
          newDueAt: futureDate(30),
          reason:
            'Representative load testing requires one additional approved production window.',
          password: 'Administration passphrase! 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    const extendedAction = extended.actions?.find(
      ({ id }) => id === followUpAction.id,
    );
    expect(extendedAction?.extensions).toHaveLength(1);
    expect(extendedAction?.extensions[0]?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(extendedAction?.effectiveDueAt).toBe(
      extendedAction?.extensions[0]?.newDueAt,
    );

    const repeatedReference = {
      fileName: 'relay-load-trend.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256:
        '1f3d5a8b2c4e6f70918273645566778899aabbccddeeff001122334455667788',
      storageReference: 'qms://controlled/CAPA-relay-load-trend/version-1',
    };
    await request(server)
      .post(`/api/v1/capas/${created.id}/actions/${followUpAction.id}/evidence`)
      .set(authA)
      .attach(
        'file',
        Buffer.from('%PDF-1.7\nAdmin must not upload this evidence.'),
        {
          filename: 'admin-report.pdf',
          contentType: 'application/pdf',
        },
      )
      .expect(403);
    await request(server)
      .post(`/api/v1/capas/${created.id}/actions/${followUpAction.id}/evidence`)
      .set(bearer(operator.accessToken))
      .attach('file', Buffer.from('not a PNG'), {
        filename: 'invalid.png',
        contentType: 'image/png',
      })
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CAPA_INVALID');
      });
    const managedPdf = Buffer.from(
      '%PDF-1.7\nControlled relay load trend evidence\n%%EOF',
    );
    const uploadedEvidence = bodyAs<{
      id: string;
      scanStatus: string;
      sha256: string;
      expiresAt: string;
    }>(
      await request(server)
        .post(
          `/api/v1/capas/${created.id}/actions/${followUpAction.id}/evidence`,
        )
        .set(bearer(operator.accessToken))
        .attach('file', managedPdf, {
          filename: 'managed-relay-trend.pdf',
          contentType: 'application/pdf',
        })
        .expect(201),
    );
    expect(uploadedEvidence).toMatchObject({ scanStatus: 'AVAILABLE' });
    expect(uploadedEvidence.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(uploadedEvidence.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    await request(server)
      .post(`/api/v1/capas/${created.id}/actions/${followUpAction.id}/complete`)
      .set(bearer(operator.accessToken))
      .send({
        ...completionInput('CAPA operator passphrase 2026'),
        evidenceReferences: [repeatedReference, repeatedReference],
      })
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('CAPA_INVALID');
      });

    const followUpImplemented = bodyAs<CapaBody>(
      await request(server)
        .post(
          `/api/v1/capas/${created.id}/actions/${followUpAction.id}/complete`,
        )
        .set(bearer(operator.accessToken))
        .send({
          ...completionInput('CAPA operator passphrase 2026'),
          evidenceReferences: [repeatedReference],
          evidenceUploadIds: [uploadedEvidence.id],
        })
        .expect(201),
    );
    expect(followUpImplemented).toMatchObject({
      status: 'FOLLOW_UP_IMPLEMENTATION_COMPLETED',
      currentCycleNumber: 1,
      completedActionCount: 3,
    });
    const completedFollowUpAction = followUpImplemented.actions?.find(
      ({ id }) => id === followUpAction.id,
    );
    expect(completedFollowUpAction?.evidenceReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storageReference: 'qms://controlled/CAPA-relay-load-trend/version-1',
          managed: false,
        }),
        expect.objectContaining({
          storageReference: `qualyra://managed/${uploadedEvidence.id}`,
          managed: true,
        }),
      ]),
    );
    const managedReference = completedFollowUpAction?.evidenceReferences.find(
      ({ managed }) => managed,
    );
    if (!managedReference?.downloadUrl) {
      throw new Error('Managed evidence download URL was not returned.');
    }
    await request(server)
      .get(`/api/v1${managedReference.downloadUrl}`)
      .set(authA)
      .expect(200)
      .expect('Content-Type', 'application/pdf')
      .expect('Cache-Control', 'private, no-store')
      .expect((response: Response) => {
        expect(response.headers['content-disposition']).toContain(
          'attachment;',
        );
        expect(response.body).toEqual(managedPdf);
      });

    const rescheduled = bodyAs<CapaBody>(
      await request(server)
        .post(`/api/v1/capas/${created.id}/effectiveness-review`)
        .set(authA)
        .send({
          criterion:
            'Verify the approved relay load trend remains within objective limits for three cycles.',
          assignedToUserId: reviewer.user.id,
          dueAt: futureDate(45),
        })
        .expect(201),
    );
    expect(rescheduled).toMatchObject({
      status: 'EFFECTIVENESS_REVIEW',
      effectivenessReview: { cycleNumber: 1, status: 'SCHEDULED' },
    });
    expect(rescheduled.effectivenessReviews).toHaveLength(2);

    const finalVerifications = await Promise.all([
      request(server)
        .post(`/api/v1/capas/${created.id}/effectiveness-review/complete`)
        .set(bearer(reviewer.accessToken))
        .send(effectivenessInput('CAPA reviewer passphrase 2026')),
      request(server)
        .post(`/api/v1/capas/${created.id}/effectiveness-review/complete`)
        .set(bearer(reviewer.accessToken))
        .send(effectivenessInput('CAPA reviewer passphrase 2026')),
    ]);
    expect(finalVerifications.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    const finalResponse = finalVerifications.find(
      ({ status }) => status === 201,
    );
    if (!finalResponse) throw new Error('Final review was not completed.');
    const finalVerified = bodyAs<CapaBody>(finalResponse);
    expect(finalVerified).toMatchObject({
      status: 'CLOSED_EFFECTIVE',
      currentCycleNumber: 1,
      effectivenessReview: {
        cycleNumber: 1,
        status: 'COMPLETED',
        decision: 'EFFECTIVE',
      },
    });

    const closedDeviation = bodyAs<DeviationBody>(
      await request(server)
        .get(`/api/v1/deviations/${deviation.id}`)
        .set(authA)
        .expect(200),
    );
    expect(closedDeviation).toMatchObject({
      status: 'CLOSED',
      closure: {
        capaId: created.id,
        decision: 'EFFECTIVE',
      },
    });
    expect(closedDeviation.closure?.recordHash).toMatch(/^[0-9a-f]{64}$/);

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
      .get('/api/v1/capas/analytics')
      .set(authA)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({
          totalCapas: 1,
          closedEffective: 1,
          effectivenessRate: 50,
        });
      });
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
        'CAPA_EFFECTIVENESS_REVIEW_SCHEDULED',
        'CAPA_EFFECTIVENESS_REAUTHENTICATION_FAILED',
        'CAPA_EFFECTIVENESS_REVIEW_COMPLETED',
        'CAPA_FOLLOW_UP_CYCLE_CREATED',
        'CAPA_ACTION_EXTENSION_APPROVED',
        'CAPA_EVIDENCE_UPLOADED',
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

function effectivenessInput(
  password: string,
  decision: 'EFFECTIVE' | 'INEFFECTIVE' = 'EFFECTIVE',
) {
  return {
    decision,
    evidence:
      'Three consecutive monitored staging cycles completed without relay alarms or temperature excursions.',
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

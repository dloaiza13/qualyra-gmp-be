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

interface DocumentBody {
  id: string;
  currentVersionNumber: number;
}

interface TrainingAssignmentBody {
  id: string;
  status: string;
  dueState: string;
  assignedTo: { id: string };
  document: { code: string };
  documentVersion: { versionNumber: number };
  meaning: string | null;
  authenticationMethod: string | null;
  completionComment: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  content?: string;
  recordHash?: string | null;
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

describeDatabase('Document training assignments', () => {
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

  it('assigns and completes effective document training with immutable evidence', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `training-a-${suffix}`);
    const tenantB = await registerCompany(server, `training-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const authB = bearer(tenantB.accessToken);

    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaManager = requiredRole(roles, 'QA Manager');
    const controllerRole = requiredRole(roles, 'Document Controller');
    const operatorRole = requiredRole(roles, 'Operator');
    expect(qaManager.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['training.read', 'training.assign']),
    );
    expect(operatorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['training.read', 'training.complete']),
    );
    expect(controllerRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['training.read', 'training.assign']),
    );

    const reviewer = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaManager.id,
      `training-reviewer-${suffix}@example.test`,
      'Training Reviewer',
      'Training reviewer passphrase 2026',
    );
    const approver = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaManager.id,
      `training-approver-${suffix}@example.test`,
      'Training Approver',
      'Training approver passphrase 2026',
    );
    const controller = await inviteAndAccept(
      server,
      authA,
      notifier,
      controllerRole.id,
      `training-controller-${suffix}@example.test`,
      'Training Document Controller',
      'Training controller passphrase 2026',
    );
    const learner = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `learner-${suffix}@example.test`,
      'Assigned Learner',
      'Operator training passphrase 2026',
    );

    const document = bodyAs<DocumentBody>(
      await request(server)
        .post('/api/v1/documents')
        .set(authA)
        .send({
          code: `TRN-SOP-${suffix}`,
          type: 'SOP',
          title: 'GMP gowning procedure',
          description: 'Controlled procedure used for training evidence.',
          content:
            '1. Review the gowning sequence.\n2. Follow every controlled step.',
          changeSummary: 'Initial training-controlled version.',
        })
        .expect(201),
    );
    await request(server)
      .post(`/api/v1/documents/${document.id}/review-request`)
      .set(authA)
      .send({
        reviewerUserId: reviewer.user.id,
        approverUserId: approver.user.id,
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/documents/${document.id}/review-decision`)
      .set(bearer(reviewer.accessToken))
      .send({ decision: 'APPROVE', comment: 'Training content reviewed.' })
      .expect(201);
    await request(server)
      .post(`/api/v1/documents/${document.id}/approval-decision`)
      .set(bearer(approver.accessToken))
      .send({
        decision: 'APPROVE',
        comment: 'Approved for controlled release.',
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/documents/${document.id}/release`)
      .set(bearer(controller.accessToken))
      .send({
        effectiveAt: new Date().toISOString(),
        reason: 'Released for assigned GMP reading.',
        password: 'Training controller passphrase 2026',
        attestationAccepted: true,
      })
      .expect(201);

    const dueAt = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    await request(server)
      .post('/api/v1/training/assignments')
      .set(authA)
      .send({
        documentId: document.id,
        assigneeUserIds: [tenantB.user.id],
        dueAt,
        reason: 'Cross-tenant assignment must be rejected.',
      })
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('TRAINING_INVALID');
      });
    await request(server)
      .post('/api/v1/training/assignments')
      .set(authA)
      .send({
        documentId: document.id,
        assigneeUserIds: [learner.user.id],
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        reason: 'Past date must be rejected.',
      })
      .expect(400);

    const created = bodyAs<TrainingAssignmentBody[]>(
      await request(server)
        .post('/api/v1/training/assignments')
        .set(authA)
        .send({
          documentId: document.id,
          assigneeUserIds: [learner.user.id],
          dueAt,
          reason: 'Required reading before independent GMP work.',
        })
        .expect(201),
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      status: 'ASSIGNED',
      dueState: 'ON_TRACK',
      assignedTo: { id: learner.user.id },
      documentVersion: { versionNumber: 1 },
    });
    const assignmentId = created[0]?.id;
    if (!assignmentId) throw new Error('Training assignment was not created.');

    await request(server)
      .post('/api/v1/training/assignments')
      .set(authA)
      .send({
        documentId: document.id,
        assigneeUserIds: [learner.user.id],
        dueAt,
        reason: 'Duplicate active assignment.',
      })
      .expect(409)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('TRAINING_CONFLICT');
      });

    const mine = bodyAs<TrainingAssignmentBody[]>(
      await request(server)
        .get('/api/v1/training/assignments/my')
        .set(bearer(learner.accessToken))
        .expect(200),
    );
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('content');
    await request(server)
      .get('/api/v1/training/assignments')
      .set(bearer(learner.accessToken))
      .expect(403);
    await request(server)
      .get(`/api/v1/training/assignments/${assignmentId}`)
      .set(bearer(controller.accessToken))
      .expect(200);

    const detail = bodyAs<TrainingAssignmentBody>(
      await request(server)
        .get(`/api/v1/training/assignments/${assignmentId}`)
        .set(bearer(learner.accessToken))
        .expect(200),
    );
    expect(detail.content).toContain('gowning sequence');

    await request(server)
      .post(`/api/v1/training/assignments/${assignmentId}/complete`)
      .set(authA)
      .send(completionInput('Administration passphrase! 2026'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('TRAINING_FORBIDDEN');
      });
    await request(server)
      .post(`/api/v1/training/assignments/${assignmentId}/complete`)
      .set(bearer(learner.accessToken))
      .send(completionInput('incorrect training password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const completions = await Promise.all([
      request(server)
        .post(`/api/v1/training/assignments/${assignmentId}/complete`)
        .set(bearer(learner.accessToken))
        .send(completionInput('Operator training passphrase 2026')),
      request(server)
        .post(`/api/v1/training/assignments/${assignmentId}/complete`)
        .set(bearer(learner.accessToken))
        .send(completionInput('Operator training passphrase 2026')),
    ]);
    expect(completions.map(({ status }) => status).sort()).toEqual([201, 409]);
    const completedResponse = completions.find(({ status }) => status === 201);
    if (!completedResponse) throw new Error('Training was not completed.');
    const completed = bodyAs<TrainingAssignmentBody>(completedResponse);
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      dueState: 'COMPLETED',
      meaning: 'TRAINING_ACKNOWLEDGEMENT',
      authenticationMethod: 'PASSWORD_REAUTHENTICATION',
    });
    expect(completed.completedAt).toEqual(expect.any(String));
    expect(completed.recordHash).toMatch(/^[0-9a-f]{64}$/);

    await request(server)
      .post(`/api/v1/training/assignments/${assignmentId}/cancel`)
      .set(authA)
      .send({ reason: 'Completed evidence cannot be cancelled.' })
      .expect(409);

    const openBeforeObsolescence = bodyAs<TrainingAssignmentBody[]>(
      await request(server)
        .post('/api/v1/training/assignments')
        .set(authA)
        .send({
          documentId: document.id,
          assigneeUserIds: [learner.user.id],
          dueAt,
          reason: 'Open assignment cancelled by document withdrawal.',
        })
        .expect(201),
    )[0];
    if (!openBeforeObsolescence) {
      throw new Error('Second training assignment was not created.');
    }

    await request(server)
      .post(`/api/v1/documents/${document.id}/obsolete`)
      .set(bearer(controller.accessToken))
      .send({
        reason: 'Procedure withdrawn from controlled use.',
        password: 'Training controller passphrase 2026',
        attestationAccepted: true,
      })
      .expect(201);

    const cancelled = bodyAs<TrainingAssignmentBody>(
      await request(server)
        .get(`/api/v1/training/assignments/${openBeforeObsolescence.id}`)
        .set(bearer(learner.accessToken))
        .expect(200),
    );
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      dueState: 'CANCELLED',
      cancellationReason: 'DOCUMENT_OBSOLETED',
    });
    await request(server)
      .get('/api/v1/training/assignments')
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
        'TRAINING_ASSIGNMENTS_CREATED',
        'TRAINING_REAUTHENTICATION_FAILED',
        'TRAINING_COMPLETED',
        'TRAINING_ASSIGNMENTS_CANCELLED',
      ]),
    );
  }, 120_000);
});

function completionInput(password: string) {
  return {
    comment:
      'I reviewed the effective procedure and its controlled responsibilities.',
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
        tenantName: `Training ${slug}`,
        tenantSlug: slug,
        adminName: 'Training Administrator',
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

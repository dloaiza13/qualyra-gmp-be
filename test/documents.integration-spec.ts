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
  tenant: { id: string; slug: string };
}

interface RoleBody {
  id: string;
  name: string;
  permissions: { code: string }[];
}

interface DocumentVersionBody {
  versionNumber: number;
  title: string;
  content: string;
  status: string;
}

interface DocumentBody {
  id: string;
  code: string;
  status: string;
  currentVersionNumber: number;
  currentVersion: DocumentVersionBody;
  versions: DocumentVersionBody[];
  workflows: {
    status: string;
    versionNumber: number;
    reviewer: { id: string };
    approver: { id: string };
    reviewComment: string | null;
    approvalComment: string | null;
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

describeDatabase('Document control foundation', () => {
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

  it('versions documents and enforces permissions and tenant isolation', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `docs-a-${suffix}`);
    const tenantB = await registerCompany(server, `docs-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const authB = bearer(tenantB.accessToken);

    const rolesResponse = await request(server)
      .get('/api/v1/roles')
      .set(authA)
      .expect(200);
    const operator = bodyAs<RoleBody[]>(rolesResponse).find(
      ({ name }) => name === 'Operator',
    );
    const qaManager = bodyAs<RoleBody[]>(rolesResponse).find(
      ({ name }) => name === 'QA Manager',
    );
    expect(operator).toBeDefined();
    expect(operator?.permissions.map(({ code }) => code)).toContain(
      'documents.read',
    );
    expect(operator?.permissions.map(({ code }) => code)).not.toContain(
      'documents.create',
    );
    expect(qaManager?.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['documents.review', 'documents.approve']),
    );

    const invalidOwner = await request(server)
      .post('/api/v1/documents')
      .set(authA)
      .send(documentInput(`QMS-SOP-${suffix}`, tenantB.user.id))
      .expect(400);
    expect(bodyAs<ErrorBody>(invalidOwner).code).toBe('DOCUMENT_INVALID');

    const createdResponse = await request(server)
      .post('/api/v1/documents')
      .set(authA)
      .send(documentInput(`qms-sop-${suffix}`))
      .expect(201);
    const created = bodyAs<DocumentBody>(createdResponse);
    expect(created).toMatchObject({
      code: `QMS-SOP-${suffix}`.toUpperCase(),
      status: 'DRAFT',
      currentVersionNumber: 1,
      currentVersion: {
        versionNumber: 1,
        title: 'Document control procedure',
        status: 'DRAFT',
      },
    });
    expect(created.versions).toHaveLength(1);

    const duplicate = await request(server)
      .post('/api/v1/documents')
      .set(authA)
      .send(documentInput(`QMS-SOP-${suffix}`))
      .expect(409);
    expect(bodyAs<ErrorBody>(duplicate).code).toBe('DOCUMENT_CODE_EXISTS');

    const listA = await request(server)
      .get('/api/v1/documents')
      .set(authA)
      .expect(200);
    expect(bodyAs<DocumentBody[]>(listA)).toHaveLength(1);
    expect(JSON.stringify(listA.body)).not.toContain('tenantId');

    await request(server)
      .get(`/api/v1/documents/${created.id}`)
      .set(authB)
      .expect(404)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DOCUMENT_NOT_FOUND');
      });
    await request(server)
      .get('/api/v1/documents')
      .set(authB)
      .expect(200)
      .expect([]);

    if (!operator) throw new Error('Operator role was not created.');
    const invitedEmail = `document-reader-${suffix}@example.test`;
    await request(server)
      .post('/api/v1/users/invitations')
      .set(authA)
      .send({ email: invitedEmail, roleIds: [operator.id] })
      .expect(201);
    const invitationToken = notifier.invitations.at(-1)?.token;
    if (!invitationToken) throw new Error('Invitation token was not recorded.');
    const acceptedResponse = await request(server)
      .post('/api/v1/invitations/accept')
      .send({
        token: invitationToken,
        displayName: 'Document Reader',
        password: 'Document reader passphrase! 2026',
      })
      .expect(200);
    const reader = bodyAs<AuthenticationBody>(acceptedResponse);
    await request(server)
      .get('/api/v1/documents')
      .set(bearer(reader.accessToken))
      .expect(200);
    await request(server)
      .post('/api/v1/documents')
      .set(bearer(reader.accessToken))
      .send(documentInput(`QMS-SOP-RESTRICTED-${suffix}`))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('FORBIDDEN');
      });

    const versionTwoResponse = await request(server)
      .post(`/api/v1/documents/${created.id}/versions`)
      .set(authA)
      .send(versionInput('Added ownership responsibilities.'))
      .expect(201);
    const versionTwo = bodyAs<DocumentBody>(versionTwoResponse);
    expect(versionTwo.currentVersionNumber).toBe(2);
    expect(versionTwo.versions.map(({ status }) => status)).toEqual([
      'DRAFT',
      'SUPERSEDED',
    ]);

    const concurrent = await Promise.all([
      request(server)
        .post(`/api/v1/documents/${created.id}/versions`)
        .set(authA)
        .send(versionInput('Concurrent revision A.')),
      request(server)
        .post(`/api/v1/documents/${created.id}/versions`)
        .set(authA)
        .send(versionInput('Concurrent revision B.')),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(concurrent.find(({ status }) => status === 409)?.body).toMatchObject(
      { code: 'DOCUMENT_VERSION_CONFLICT' },
    );

    const detailResponse = await request(server)
      .get(`/api/v1/documents/${created.id}`)
      .set(authA)
      .expect(200);
    const detail = bodyAs<DocumentBody>(detailResponse);
    expect(detail.currentVersionNumber).toBe(3);
    expect(detail.versions).toHaveLength(3);
    expect(detail.versions[0]?.content).toEqual(expect.any(String));

    if (!qaManager) throw new Error('QA Manager role was not created.');
    const reviewer = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaManager.id,
      `reviewer-${suffix}@example.test`,
      'Assigned Reviewer',
    );
    const approver = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaManager.id,
      `approver-${suffix}@example.test`,
      'Assigned Approver',
    );

    await request(server)
      .post(`/api/v1/documents/${created.id}/review-request`)
      .set(authA)
      .send({
        reviewerUserId: tenantA.user.id,
        approverUserId: approver.user.id,
      })
      .expect(400)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DOCUMENT_WORKFLOW_INVALID');
      });

    const requested = await request(server)
      .post(`/api/v1/documents/${created.id}/review-request`)
      .set(authA)
      .send({
        reviewerUserId: reviewer.user.id,
        approverUserId: approver.user.id,
      })
      .expect(201);
    expect(bodyAs<DocumentBody>(requested)).toMatchObject({
      status: 'IN_REVIEW',
      currentVersion: { status: 'IN_REVIEW' },
      workflows: [
        {
          status: 'PENDING_REVIEW',
          versionNumber: 3,
          reviewer: { id: reviewer.user.id },
          approver: { id: approver.user.id },
        },
      ],
    });

    await request(server)
      .post(`/api/v1/documents/${created.id}/review-decision`)
      .set(bearer(approver.accessToken))
      .send({ decision: 'APPROVE', comment: 'Attempted by wrong assignee.' })
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DOCUMENT_DECISION_FORBIDDEN');
      });

    const reviewDecisions = await Promise.all([
      request(server)
        .post(`/api/v1/documents/${created.id}/review-decision`)
        .set(bearer(reviewer.accessToken))
        .send({ decision: 'APPROVE', comment: 'GMP review completed.' }),
      request(server)
        .post(`/api/v1/documents/${created.id}/review-decision`)
        .set(bearer(reviewer.accessToken))
        .send({ decision: 'APPROVE', comment: 'Duplicate review decision.' }),
    ]);
    expect(reviewDecisions.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    const acceptedReview = reviewDecisions.find(({ status }) => status === 201);
    if (!acceptedReview) throw new Error('Review decision was not accepted.');
    const acceptedReviewBody = bodyAs<DocumentBody>(acceptedReview);
    expect(acceptedReviewBody).toMatchObject({
      status: 'IN_REVIEW',
      workflows: [{ status: 'PENDING_APPROVAL' }],
    });
    expect(acceptedReviewBody.workflows[0]?.reviewComment).toEqual(
      expect.any(String),
    );

    const approvedResponse = await request(server)
      .post(`/api/v1/documents/${created.id}/approval-decision`)
      .set(bearer(approver.accessToken))
      .send({
        decision: 'APPROVE',
        comment: 'Approved for controlled release preparation.',
      })
      .expect(201);
    expect(bodyAs<DocumentBody>(approvedResponse)).toMatchObject({
      status: 'APPROVED',
      currentVersion: { status: 'APPROVED' },
      workflows: [
        {
          status: 'APPROVED',
          approvalComment: 'Approved for controlled release preparation.',
        },
      ],
    });

    await request(server)
      .post(`/api/v1/documents/${created.id}/versions`)
      .set(authA)
      .send(versionInput('Revision after approval is deferred to release.'))
      .expect(409)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DOCUMENT_VERSION_CONFLICT');
      });

    const rejectedDocument = bodyAs<DocumentBody>(
      await request(server)
        .post('/api/v1/documents')
        .set(authA)
        .send(documentInput(`QMS-REJECT-${suffix}`))
        .expect(201),
    );
    await request(server)
      .post(`/api/v1/documents/${rejectedDocument.id}/review-request`)
      .set(authA)
      .send({
        reviewerUserId: reviewer.user.id,
        approverUserId: approver.user.id,
      })
      .expect(201);
    const rejected = await request(server)
      .post(`/api/v1/documents/${rejectedDocument.id}/review-decision`)
      .set(bearer(reviewer.accessToken))
      .send({
        decision: 'REJECT',
        comment: 'Correct the responsibility matrix.',
      })
      .expect(201);
    expect(bodyAs<DocumentBody>(rejected)).toMatchObject({
      status: 'DRAFT',
      currentVersion: { status: 'DRAFT' },
      workflows: [{ status: 'REJECTED' }],
    });
    await request(server)
      .post(`/api/v1/documents/${rejectedDocument.id}/review-request`)
      .set(authA)
      .send({
        reviewerUserId: reviewer.user.id,
        approverUserId: approver.user.id,
      })
      .expect(409)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('DOCUMENT_WORKFLOW_CONFLICT');
      });
    const corrected = bodyAs<DocumentBody>(
      await request(server)
        .post(`/api/v1/documents/${rejectedDocument.id}/versions`)
        .set(authA)
        .send(versionInput('Corrected responsibility matrix.'))
        .expect(201),
    );
    expect(corrected.currentVersionNumber).toBe(2);
    await request(server)
      .post(`/api/v1/documents/${rejectedDocument.id}/review-request`)
      .set(authA)
      .send({
        reviewerUserId: reviewer.user.id,
        approverUserId: approver.user.id,
      })
      .expect(201);

    const events = await request(server)
      .get('/api/v1/security-events?limit=100')
      .set(authA)
      .expect(200);
    expect(
      bodyAs<{ eventType: string }[]>(events).map(({ eventType }) => eventType),
    ).toEqual(
      expect.arrayContaining([
        'DOCUMENT_CREATED',
        'DOCUMENT_VERSION_CREATED',
        'DOCUMENT_REVIEW_REQUESTED',
        'DOCUMENT_REVIEW_COMPLETED',
        'DOCUMENT_APPROVED',
        'DOCUMENT_REVIEW_REJECTED',
      ]),
    );
  }, 90_000);
});

async function inviteAndAccept(
  server: Parameters<typeof request>[0],
  authorization: Record<string, string>,
  notifier: RecordingNotifier,
  roleId: string,
  email: string,
  displayName: string,
): Promise<AuthenticationBody> {
  await request(server)
    .post('/api/v1/users/invitations')
    .set(authorization)
    .send({ email, roleIds: [roleId] })
    .expect(201);
  const token = notifier.invitations.at(-1)?.token;
  if (!token) throw new Error('Invitation token was not recorded.');
  const accepted = await request(server)
    .post('/api/v1/invitations/accept')
    .send({
      token,
      displayName,
      password: 'Qualified assignee passphrase! 2026',
    })
    .expect(200);
  return bodyAs<AuthenticationBody>(accepted);
}

async function registerCompany(
  server: Parameters<typeof request>[0],
  slug: string,
): Promise<AuthenticationBody> {
  const response = await request(server)
    .post('/api/v1/auth/register-company')
    .send({
      tenantName: `Company ${slug}`,
      tenantSlug: slug,
      adminName: 'Document Administrator',
      email: `admin-${slug}@example.test`,
      password: 'Administration passphrase! 2026',
    })
    .expect(201);
  return bodyAs<AuthenticationBody>(response);
}

function documentInput(code: string, ownerUserId?: string) {
  return {
    code,
    type: 'SOP',
    ownerUserId,
    title: 'Document control procedure',
    description: 'Controlled procedure for document lifecycle management.',
    content: '1. Purpose\nDefine how controlled documents are maintained.',
    changeSummary: 'Initial controlled draft.',
  };
}

function versionInput(changeSummary: string) {
  return {
    title: 'Document control procedure',
    description: 'Controlled procedure for document lifecycle management.',
    content: '1. Purpose\nDefine ownership and version traceability.',
    changeSummary,
  };
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function bodyAs<T>(response: Response): T {
  return response.body as T;
}

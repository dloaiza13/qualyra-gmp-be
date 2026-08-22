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
interface ProductReviewBody {
  id: string;
  code: string;
  status: string;
  dueState: string;
  productCode: string;
  assessment: {
    recordHash: string;
    preparedBy: { id: string };
    trendSnapshot: {
      complaints: { current: number; previous: number; direction: string };
      recalls: { current: number; previous: number; direction: string };
      monthly: { month: string; complaints: number; recalls: number }[];
    };
  } | null;
  decision: {
    recordHash: string;
    decidedBy: { id: string };
    decision: string;
  } | null;
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

describeDatabase('periodic product quality review lifecycle', () => {
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

  it('isolates PQR records and preserves signed assessment, trend snapshot, and independent approval', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `pqr-a-${suffix}`);
    const tenantB = await registerCompany(server, `pqr-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaRole = requiredRole(roles, 'QA Manager');
    expect(qaRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'product_reviews.read',
        'product_reviews.prepare',
        'product_reviews.approve',
      ]),
    );
    const preparer = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `pqr-preparer-${suffix}@example.test`,
      'PQR Preparer',
      'PQR preparer passphrase 2026',
    );
    const approver = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `pqr-approver-${suffix}@example.test`,
      'PQR Approver',
      'PQR approver passphrase 2026',
    );

    const created = bodyAs<ProductReviewBody>(
      await request(server)
        .post('/api/v1/product-reviews')
        .set(authA)
        .send(reviewInput(approver.user.id))
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `PQR-${new Date().getUTCFullYear()}-0001`,
      productCode: 'SOL-10',
      status: 'DRAFT',
      dueState: 'ON_TRACK',
    });
    await request(server)
      .get(`/api/v1/product-reviews/${created.id}`)
      .set(bearer(tenantB.accessToken))
      .expect(404);

    await request(server)
      .post(`/api/v1/product-reviews/${created.id}/assessment`)
      .set(bearer(preparer.accessToken))
      .send(assessmentInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });

    const assessed = bodyAs<ProductReviewBody>(
      await request(server)
        .post(`/api/v1/product-reviews/${created.id}/assessment`)
        .set(bearer(preparer.accessToken))
        .send(assessmentInput('PQR preparer passphrase 2026'))
        .expect(201),
    );
    expect(assessed.status).toBe('PENDING_APPROVAL');
    expect(assessed.assessment?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(assessed.assessment?.preparedBy.id).toBe(preparer.user.id);
    expect(assessed.assessment?.trendSnapshot).toMatchObject({
      complaints: { current: 0, previous: 0, direction: 'STABLE' },
      recalls: { current: 0, previous: 0, direction: 'STABLE' },
    });
    expect(assessed.assessment?.trendSnapshot.monthly).toHaveLength(12);

    const approved = bodyAs<ProductReviewBody>(
      await request(server)
        .post(`/api/v1/product-reviews/${created.id}/decision`)
        .set(bearer(approver.accessToken))
        .send({
          decision: 'APPROVE',
          rationale:
            'The review covers the defined period and supports continued manufacture under the validated state.',
          followUpReference:
            'No follow-up required; routine monitoring continues.',
          nextReviewAt: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          password: 'PQR approver passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      dueState: 'COMPLETED',
    });
    expect(approved.decision?.decision).toBe('APPROVE');
    expect(approved.decision?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approved.decision?.decidedBy.id).toBe(approver.user.id);

    await request(server)
      .post('/api/v1/product-reviews')
      .set(authA)
      .send(reviewInput(approver.user.id))
      .expect(409)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('PRODUCT_REVIEW_CONFLICT');
      });

    const cancellable = bodyAs<ProductReviewBody>(
      await request(server)
        .post('/api/v1/product-reviews')
        .set(authA)
        .send({
          ...reviewInput(approver.user.id),
          periodStart: '2024-01-01',
          periodEnd: '2024-12-31',
        })
        .expect(201),
    );
    const cancelled = bodyAs<ProductReviewBody>(
      await request(server)
        .post(`/api/v1/product-reviews/${cancellable.id}/cancellation`)
        .set(authA)
        .send({
          reason:
            'The review scope used an obsolete product authorization and was created in error.',
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
        'PRODUCT_REVIEW_CREATED',
        'PRODUCT_REVIEW_ASSESSMENT_REAUTHENTICATION_FAILED',
        'PRODUCT_REVIEW_ASSESSMENT_SIGNED',
        'PRODUCT_REVIEW_DECIDED',
        'PRODUCT_REVIEW_CANCELLED',
      ]),
    );
  }, 180_000);
});

function reviewInput(approverUserId: string) {
  return {
    productName: 'Sterile solution 10 mL',
    productCode: 'sol-10',
    dosageForm: 'Sterile solution',
    strength: '10 mg/mL',
    marketAuthorization: 'MA-GT-2025-00182',
    periodStart: '2025-01-01',
    periodEnd: '2025-12-31',
    targetCompletionAt: new Date(
      Date.now() + 45 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    approverUserId,
  };
}

function assessmentInput(password: string) {
  return {
    batchesManufactured: 48,
    batchesReleased: 47,
    batchesRejected: 1,
    outOfSpecificationCount: 2,
    stabilityExceptionCount: 1,
    returnedUnitCount: 24,
    manufacturingSummary:
      'All commercial batches manufactured in the review period were reconciled against the approved schedule.',
    startingMaterialsSummary:
      'Starting materials and packaging components remained within approved specifications and supplier status.',
    criticalQualityAttributesSummary:
      'Critical quality attributes remained within registered acceptance criteria with no adverse drift.',
    processPerformanceSummary:
      'Process capability and yield trends remained stable across the reviewed commercial batches.',
    stabilitySummary:
      'The stability program remained current; one documented exception did not alter the registered shelf life.',
    validationSummary:
      'The process, cleaning, analytical methods, and computerized controls remained in a validated state.',
    regulatorySummary:
      'No unresolved regulatory commitment changes the approved product authorization or control strategy.',
    trendAnalysis:
      'Complaint and field-action trends were reviewed against the equivalent previous period and remain acceptable.',
    benefitRiskConclusion:
      'The total evidence supports an unchanged favorable benefit-risk balance for continued distribution.',
    recommendations:
      'Continue routine monitoring and verify the documented stability exception in the next review cycle.',
    evidenceReference:
      'Annual product review evidence index PQR-EVID-2025-SOL10.',
    continuedManufactureRecommended: true,
    capaRequired: false,
    changeControlRequired: false,
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
        tenantName: `Product Review ${slug}`,
        tenantSlug: slug,
        adminName: 'Product Review Administrator',
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

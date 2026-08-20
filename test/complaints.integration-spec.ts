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
interface ComplaintBody {
  id: string;
  code: string;
  status: string;
  severity: string | null;
  dueState: string;
  investigation: { recordHash: string; investigatedBy: { id: string } } | null;
  decision: { recordHash: string; decidedBy: { id: string } } | null;
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

describeDatabase('product quality complaint lifecycle', () => {
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

  it('isolates intake and preserves independent signed investigation and decision evidence', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `complaint-a-${suffix}`);
    const tenantB = await registerCompany(server, `complaint-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const operatorRole = requiredRole(roles, 'Operator');
    const auditorRole = requiredRole(roles, 'Auditor');
    expect(operatorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'complaints.read',
        'complaints.create',
        'complaints.investigate',
      ]),
    );
    expect(auditorRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['complaints.read', 'complaints.review']),
    );
    const investigator = await inviteAndAccept(
      server,
      authA,
      notifier,
      operatorRole.id,
      `complaint-investigator-${suffix}@example.test`,
      'Complaint Investigator',
      'Complaint investigator passphrase 2026',
    );
    const reviewer = await inviteAndAccept(
      server,
      authA,
      notifier,
      auditorRole.id,
      `complaint-reviewer-${suffix}@example.test`,
      'Complaint Reviewer',
      'Complaint reviewer passphrase 2026',
    );

    const created = bodyAs<ComplaintBody>(
      await request(server)
        .post('/api/v1/complaints')
        .set(bearer(investigator.accessToken))
        .send(complaintInput())
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `PQC-${new Date().getUTCFullYear()}-0001`,
      status: 'REPORTED',
      dueState: 'NOT_SCHEDULED',
    });
    await request(server)
      .get(`/api/v1/complaints/${created.id}`)
      .set(bearer(tenantB.accessToken))
      .expect(404);

    const triaged = bodyAs<ComplaintBody>(
      await request(server)
        .post(`/api/v1/complaints/${created.id}/triage`)
        .set(authA)
        .send({
          severity: 'CRITICAL',
          regulatoryAssessment: 'UNDER_EVALUATION',
          recallAssessmentRequired: true,
          immediateActions:
            'Quarantined retained samples and escalated patient safety and recall assessments to the responsible processes.',
          targetCloseAt: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          investigatorUserId: investigator.user.id,
          reviewerUserId: reviewer.user.id,
        })
        .expect(201),
    );
    expect(triaged).toMatchObject({
      status: 'UNDER_INVESTIGATION',
      severity: 'CRITICAL',
    });

    await request(server)
      .post(`/api/v1/complaints/${created.id}/investigation`)
      .set(bearer(investigator.accessToken))
      .send(investigationInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });
    const investigated = bodyAs<ComplaintBody>(
      await request(server)
        .post(`/api/v1/complaints/${created.id}/investigation`)
        .set(bearer(investigator.accessToken))
        .send(investigationInput('Complaint investigator passphrase 2026'))
        .expect(201),
    );
    expect(investigated.status).toBe('PENDING_REVIEW');
    expect(investigated.investigation?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(investigated.investigation?.investigatedBy.id).toBe(
      investigator.user.id,
    );

    const closed = bodyAs<ComplaintBody>(
      await request(server)
        .post(`/api/v1/complaints/${created.id}/decision`)
        .set(bearer(reviewer.accessToken))
        .send({
          disposition: 'SUBSTANTIATED',
          rationale:
            'The retained-sample result and batch review confirm the reported particulate defect.',
          finalResponseReference: 'QMS-RESPONSE-2026-0044',
          regulatoryAction:
            'The regulatory reporting assessment was transferred to Regulatory Affairs for jurisdictional completion.',
          recallActionRequired: true,
          password: 'Complaint reviewer passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(closed).toMatchObject({ status: 'CLOSED', dueState: 'COMPLETED' });
    expect(closed.decision?.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(closed.decision?.decidedBy.id).toBe(reviewer.user.id);

    const cancellable = bodyAs<ComplaintBody>(
      await request(server)
        .post('/api/v1/complaints')
        .set(authA)
        .send({ ...complaintInput(), title: 'Duplicate complaint record' })
        .expect(201),
    );
    const cancelled = bodyAs<ComplaintBody>(
      await request(server)
        .post(`/api/v1/complaints/${cancellable.id}/cancellation`)
        .set(authA)
        .send({
          reason:
            'This record duplicates the original customer communication and was created in error.',
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
        'COMPLAINT_REPORTED',
        'COMPLAINT_TRIAGED',
        'COMPLAINT_INVESTIGATION_REAUTHENTICATION_FAILED',
        'COMPLAINT_INVESTIGATION_COMPLETED',
        'COMPLAINT_DECIDED',
        'COMPLAINT_CANCELLED',
      ]),
    );
  }, 120_000);
});

function complaintInput() {
  return {
    title: 'Visible particles reported in sterile solution',
    description:
      'A customer observed visible particles in an unopened vial before administration and supplied photographs.',
    source: 'CUSTOMER',
    category: 'PRODUCT_QUALITY',
    productName: 'Sterile solution 10 mL',
    productCode: 'SOL-10',
    lotNumber: `LOT-${Date.now()}`,
    expiryDate: '2028-06-30',
    countryCode: 'GT',
    receivedAt: new Date().toISOString(),
    reporterName: 'Customer Quality Unit',
    reporterContact: 'quality.customer@example.test',
    evidenceReference: 'CRM-882 and customer-supplied photographs',
    potentialSafetyEvent: true,
  };
}

function investigationInput(password: string) {
  return {
    investigationSummary:
      'Reviewed batch records, environmental monitoring, visual inspection data, retains, and distribution history.',
    rootCause:
      'A component-washing parameter excursion was identified as the most probable assignable cause.',
    batchImpact:
      'The investigated batch showed an elevated but isolated visual-defect signal requiring controlled disposition.',
    distributedProductImpact:
      'Distribution traceability was completed and the potential scope was communicated for recall assessment.',
    sampleEvaluation:
      'Retained samples were examined using the approved method and one matching visible particle was confirmed.',
    evidenceReference:
      'INV-PQC-0001 report, laboratory worksheet, batch record review, and distribution reconciliation',
    recommendedDisposition: 'SUBSTANTIATED',
    responseRecommendation:
      'Acknowledge the confirmed defect, describe containment, and communicate the independent final decision.',
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
        tenantName: `Complaint ${slug}`,
        tenantSlug: slug,
        adminName: 'Complaint Administrator',
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

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
interface EquipmentBody {
  id: string;
  code: string;
  status: string;
  approvedForUse: boolean;
  nextCalibrationAt: string | null;
  nextMaintenanceAt: string | null;
  retirementRecordHash: string | null;
  calibrations: {
    id: string;
    status: string;
    result: string;
    recordHash: string;
    review: { decision: string; recordHash: string } | null;
  }[];
  maintenances: {
    id: string;
    status: string;
    result: string;
    recordHash: string;
    review: { decision: string; recordHash: string } | null;
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

describeDatabase('GMP equipment lifecycle', () => {
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

  it('isolates equipment and preserves signed calibration, maintenance, and retirement evidence', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const tenantA = await registerCompany(server, `equipment-a-${suffix}`);
    const tenantB = await registerCompany(server, `equipment-b-${suffix}`);
    const authA = bearer(tenantA.accessToken);
    const roles = bodyAs<RoleBody[]>(
      await request(server).get('/api/v1/roles').set(authA).expect(200),
    );
    const qaRole = requiredRole(roles, 'QA Manager');
    expect(qaRole.permissions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'equipment.read',
        'equipment.calibrate',
        'equipment.maintain',
        'equipment.verify',
        'equipment.retire',
      ]),
    );
    const owner = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `equipment-owner-${suffix}@example.test`,
      'Equipment Owner',
      'Equipment owner passphrase 2026',
    );
    const verifier = await inviteAndAccept(
      server,
      authA,
      notifier,
      qaRole.id,
      `equipment-verifier-${suffix}@example.test`,
      'Equipment Verifier',
      'Equipment verifier passphrase 2026',
    );

    const created = bodyAs<EquipmentBody>(
      await request(server)
        .post('/api/v1/equipment')
        .set(authA)
        .send(equipmentInput(owner.user.id, verifier.user.id))
        .expect(201),
    );
    expect(created).toMatchObject({
      code: `EQP-${new Date().getUTCFullYear()}-0001`,
      status: 'ACTIVE',
      approvedForUse: true,
    });
    await request(server)
      .get(`/api/v1/equipment/${created.id}`)
      .set(bearer(tenantB.accessToken))
      .expect(404);

    await request(server)
      .post(`/api/v1/equipment/${created.id}/calibrations`)
      .set(bearer(owner.accessToken))
      .send(calibrationInput('wrong password'))
      .expect(403)
      .expect(({ body }: { body: ErrorBody }) => {
        expect(body.code).toBe('REAUTHENTICATION_FAILED');
      });
    const calibrationPending = bodyAs<EquipmentBody>(
      await request(server)
        .post(`/api/v1/equipment/${created.id}/calibrations`)
        .set(bearer(owner.accessToken))
        .send(calibrationInput('Equipment owner passphrase 2026'))
        .expect(201),
    );
    expect(calibrationPending).toMatchObject({
      status: 'OUT_OF_SERVICE',
      approvedForUse: false,
    });
    expect(calibrationPending.calibrations[0]?.recordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    const calibrationId = calibrationPending.calibrations[0]?.id;
    if (!calibrationId) throw new Error('Calibration was not created.');
    const calibrated = bodyAs<EquipmentBody>(
      await request(server)
        .post(
          `/api/v1/equipment/${created.id}/calibrations/${calibrationId}/review`,
        )
        .set(bearer(verifier.accessToken))
        .send(reviewInput('Equipment verifier passphrase 2026'))
        .expect(201),
    );
    expect(calibrated).toMatchObject({
      status: 'ACTIVE',
      approvedForUse: true,
    });
    expect(calibrated.calibrations[0]?.review?.recordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const maintenancePending = bodyAs<EquipmentBody>(
      await request(server)
        .post(`/api/v1/equipment/${created.id}/maintenances`)
        .set(bearer(owner.accessToken))
        .send(maintenanceInput('Equipment owner passphrase 2026'))
        .expect(201),
    );
    const maintenanceId = maintenancePending.maintenances[0]?.id;
    if (!maintenanceId) throw new Error('Maintenance was not created.');
    const maintained = bodyAs<EquipmentBody>(
      await request(server)
        .post(
          `/api/v1/equipment/${created.id}/maintenances/${maintenanceId}/review`,
        )
        .set(bearer(verifier.accessToken))
        .send(reviewInput('Equipment verifier passphrase 2026'))
        .expect(201),
    );
    expect(maintained).toMatchObject({
      status: 'ACTIVE',
      approvedForUse: true,
    });
    expect(maintained.maintenances[0]?.review?.recordHash).toMatch(
      /^[0-9a-f]{64}$/,
    );

    const retired = bodyAs<EquipmentBody>(
      await request(server)
        .post(`/api/v1/equipment/${created.id}/retirement`)
        .set(bearer(verifier.accessToken))
        .send({
          reason:
            'The unit reached end of validated service life and was replaced.',
          password: 'Equipment verifier passphrase 2026',
          attestationAccepted: true,
        })
        .expect(201),
    );
    expect(retired).toMatchObject({ status: 'RETIRED', approvedForUse: false });
    expect(retired.retirementRecordHash).toMatch(/^[0-9a-f]{64}$/);

    const events = bodyAs<{ eventType: string }[]>(
      await request(server)
        .get('/api/v1/security-events?limit=100')
        .set(authA)
        .expect(200),
    );
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'EQUIPMENT_REGISTERED',
        'CALIBRATION_REAUTHENTICATION_FAILED',
        'EQUIPMENT_CALIBRATION_COMPLETED',
        'EQUIPMENT_CALIBRATION_REVIEWED',
        'EQUIPMENT_MAINTENANCE_COMPLETED',
        'EQUIPMENT_MAINTENANCE_REVIEWED',
        'EQUIPMENT_RETIRED',
      ]),
    );
  }, 120_000);
});

function equipmentInput(ownerUserId: string, verifierUserId: string) {
  return {
    name: 'Tablet compression force gauge',
    category: 'MEASUREMENT',
    criticality: 'CRITICAL',
    manufacturer: 'Metrology Systems',
    model: 'FG-800',
    serialNumber: `FG-${Date.now()}`,
    location: 'Compression suite 2',
    processArea: 'Solid dosage manufacturing',
    intendedUse:
      'Measures compression force during setup and in-process verification of commercial tablet batches.',
    ownerUserId,
    verifierUserId,
    calibrationRequired: true,
    calibrationIntervalDays: 180,
    nextCalibrationAt: new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    maintenanceRequired: true,
    maintenanceIntervalDays: 365,
    nextMaintenanceAt: new Date(
      Date.now() + 180 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function calibrationInput(password: string) {
  return {
    result: 'PASS',
    certificateReference: 'CAL-2026-1187',
    standardReference: 'NIST traceable load-cell standard STD-LC-42',
    readingsSummary:
      'All five verification points were within the approved tolerance of plus or minus 0.5 percent.',
    password,
    attestationAccepted: true,
  };
}

function maintenanceInput(password: string) {
  return {
    type: 'PREVENTIVE',
    workOrderReference: 'WO-2026-0441',
    workPerformed:
      'Inspected load cell, cleaned contact surfaces, verified cable integrity, and completed functional test.',
    partsAndMaterials: 'Approved lint-free wipes and connector seal kit PS-14',
    evidenceReference:
      'WO-2026-0441 completion report and functional test attachment',
    result: 'SATISFACTORY',
    password,
    attestationAccepted: true,
  };
}

function reviewInput(password: string) {
  return {
    decision: 'ACCEPT',
    rationale:
      'The signed record, traceability, results, and objective evidence meet the approved procedure.',
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
        tenantName: `Equipment ${slug}`,
        tenantSlug: slug,
        adminName: 'Equipment Administrator',
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

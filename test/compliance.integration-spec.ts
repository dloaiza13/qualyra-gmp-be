import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request, { type Response } from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { JwtAuthGuard } from '../src/modules/authentication/presentation/jwt-auth.guard.js';
import {
  TenantUnitOfWork,
  type TenantWork,
} from '../src/modules/tenancy/application/ports/tenant-unit-of-work.js';
import type { AuthenticatedPrincipal } from '../src/modules/authentication/domain/authenticated-principal.js';
import type { RequestWithContext } from '../src/common/request-context/request-with-context.js';
import type {
  ComplianceFrameworkResponseDto,
  ComplianceControlResponseDto,
  ComplianceFindingResponseDto,
  ComplianceReadinessResponseDto,
  ComplianceEvaluationRunResponseDto,
  ComplianceReadinessPolicyResponseDto,
  ComplianceScoreSnapshotResponseDto,
} from '../src/modules/compliance/application/dto/compliance-response.dto.js';
import { lockComplianceTenant } from '../src/modules/compliance/application/compliance-transaction-lock.js';

const describeDatabase =
  process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('Compliance phases 1–3 integration', () => {
  let app: INestApplication;
  let transaction: Prisma.TransactionClient;
  const owner = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    }),
  });
  const principals = new Map<string, AuthenticatedPrincipal>();
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const rollback = new Error('ROLLBACK_COMPLIANCE_TEST_FIXTURE');

  beforeAll(async () => {
    const unitOfWork = {
      execute: async <T>(tenantId: string, work: TenantWork<T>): Promise<T> => {
        await transaction.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return work(transaction);
      },
    };
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TenantUnitOfWork)
      .useValue(unitOfWork)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context
            .switchToHttp()
            .getRequest<
              RequestWithContext & { headers: Record<string, string> }
            >();
          req.principal = principals.get(req.headers['x-test-actor']);
          return Boolean(req.principal);
        },
      })
      .compile();
    app = fixture.createNestApplication({ bodyParser: false });
    app.useLogger(false);
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner.$disconnect();
  });

  it('enforces permissions, tenant relationships, rule reconciliation, evidence dates and immutable history', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await owner
      .$transaction(
        async (tx) => {
          transaction = tx;
          await fixture(tenantA, 'manager', [
            'compliance.read',
            'compliance.manage',
            'compliance.evaluate',
            'compliance.findings.manage',
            'compliance.frameworks.read',
            'compliance.frameworks.manage',
          ]);
          await fixture(tenantA, 'reader', ['compliance.read']);
          await fixture(tenantA, 'operator', []);
          await fixture(tenantB, 'other', [
            'compliance.read',
            'compliance.manage',
            'compliance.evaluate',
            'compliance.findings.manage',
            'compliance.frameworks.read',
            'compliance.frameworks.manage',
          ]);
          const get = (path: string, actor = 'manager') =>
            request(server)
              .get(`/api/v1/compliance/${path}`)
              .set('x-test-actor', actor);
          const post = (path: string, body: object, actor = 'manager') =>
            request(server)
              .post(`/api/v1/compliance/${path}`)
              .set('x-test-actor', actor)
              .send(body);
          const patch = (path: string, body: object, actor = 'manager') =>
            request(server)
              .patch(`/api/v1/compliance/${path}`)
              .set('x-test-actor', actor)
              .send(body);
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness').expect(200),
            ).overallScore,
          ).toBeNull();
          await get('readiness', 'operator').expect(403);
          await post('frameworks', {}, 'reader').expect(403);
          await patch(
            'readiness/policy',
            { criticalPenalty: 20 },
            'reader',
          ).expect(403);
          await post(
            'evaluations',
            { idempotencyKey: randomUUID() },
            'reader',
          ).expect(403);
          await post('readiness/snapshots', {}, 'reader').expect(403);
          await get('readiness', 'reader').expect(200);

          const frameworkInput = {
            code: 'TEST-QMS',
            name: 'Test quality framework',
            version: '1',
            description: 'Original test framework summary.',
          };
          const framework = body<ComplianceFrameworkResponseDto>(
            await post('frameworks', frameworkInput).expect(201),
          );
          const otherFramework = body<ComplianceFrameworkResponseDto>(
            await post('frameworks', frameworkInput, 'other').expect(201),
          );
          const requirementInput = {
            code: '7.6',
            title: 'Equipment traceability',
            description: 'Keep equipment under current control.',
            severity: 'CRITICAL',
            weight: 1,
            mandatory: true,
            sortOrder: 1,
          };
          const withRequirement = body<ComplianceFrameworkResponseDto>(
            await post(
              `frameworks/${framework.id}/requirements`,
              requirementInput,
            ).expect(201),
          );
          const requirementId = withRequirement.requirements[0].id;
          const otherRequirement = body<ComplianceFrameworkResponseDto>(
            await post(
              `frameworks/${otherFramework.id}/requirements`,
              requirementInput,
              'other',
            ).expect(201),
          ).requirements[0].id;
          await post(`frameworks/${framework.id}/requirements`, {
            ...requirementInput,
            code: '8.5',
            parentRequirementId: otherRequirement,
          }).expect(400);
          const controlInput = {
            code: 'CTL-TEST',
            name: 'Equipment control',
            description: 'Ensure calibration records remain current.',
            category: 'Calibration',
            requirementIds: [requirementId],
            status: 'DRAFT',
          };
          await post('controls', {
            ...controlInput,
            requirementIds: [otherRequirement],
          }).expect(400);
          const control = body<ComplianceControlResponseDto>(
            await post('controls', controlInput).expect(201),
          );
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness').expect(200),
            ).overallScore,
          ).toBe(95);
          await patch(`controls/${control.id}`, { status: 'ACTIVE' }).expect(
            200,
          );
          expect(
            body<ComplianceControlResponseDto>(
              await patch(`controls/${control.id}`, {
                name: 'Updated equipment control',
              }).expect(200),
            ).status,
          ).toBe('ACTIVE');
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness').expect(200),
            ).overallScore,
          ).toBe(98);
          await patch(
            `controls/${control.id}`,
            { status: 'ACTIVE' },
            'other',
          ).expect(404);

          const manager = principals.get('manager')!;
          const equipmentId = randomUUID();
          await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
          await tx.equipment.create({
            data: {
              id: equipmentId,
              tenantId: tenantA,
              code: 'EQP-TEST-0001',
              name: 'Compliance balance',
              category: 'MEASUREMENT',
              criticality: 'CRITICAL',
              manufacturer: 'Test',
              model: 'Test',
              serialNumber: equipmentId,
              location: 'QA laboratory',
              processArea: 'QA',
              intendedUse: 'Compliance integration test measurements.',
              ownerUserId: manager.userId,
              verifierUserId: principals.get('reader')!.userId,
              createdByUserId: manager.userId,
              calibrationRequired: true,
              calibrationIntervalDays: 30,
              nextCalibrationAt: new Date(Date.now() - 10 * 86400000),
              maintenanceRequired: false,
            },
          });
          const evidenceInput = {
            controlId: control.id,
            sourceEntityType: 'EQUIPMENT',
            sourceEntityId: equipmentId,
            sourceReference: 'EQP-TEST-0001',
            description: 'Equipment control evidence.',
            validUntil: new Date().toISOString().slice(0, 10),
          };
          await post('evidence', evidenceInput).expect(201);
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness').expect(200),
            ).overallScore,
          ).toBe(100);
          await post('evidence', {
            ...evidenceInput,
            sourceEntityId: randomUUID(),
          }).expect(400);
          await post('evidence', evidenceInput, 'other').expect(404);
          const second = body<ComplianceFrameworkResponseDto>(
            await post(`frameworks/${framework.id}/requirements`, {
              ...requirementInput,
              code: '8.5.2',
              mandatory: false,
            }).expect(201),
          ).requirements.find(({ code }) => code === '8.5.2')!;
          await post('evidence', {
            ...evidenceInput,
            requirementId: second.id,
          }).expect(400);
          await patch(`controls/${control.id}`, {
            requirementIds: [requirementId, second.id],
          }).expect(200);
          await patch(`controls/${control.id}`, {
            requirementIds: [requirementId],
          }).expect(200);

          const rule = body<{ id: string }>(
            await post('rules', {
              key: 'CALIBRATION-OVERDUE',
              name: 'Calibration overdue',
              description: 'Identify overdue equipment calibration.',
              implementationKey: 'EQUIPMENT_CALIBRATION_OVERDUE_V1',
              category: 'Calibration',
              severity: 'CRITICAL',
              requirementId,
              controlId: control.id,
              configuration: { minimumDaysOverdue: 0 },
            }).expect(201),
          );
          const key = randomUUID();
          const firstRun = body<ComplianceEvaluationRunResponseDto>(
            await post('evaluations', { idempotencyKey: key }).expect(201),
          );
          expect(firstRun).toMatchObject({
            status: 'COMPLETED',
            findingsCreated: 1,
            violationsDetected: 1,
          });
          expect(
            body<ComplianceEvaluationRunResponseDto>(
              await post('evaluations', { idempotencyKey: key }).expect(201),
            ).id,
          ).toBe(firstRun.id);
          expect(
            body<ComplianceEvaluationRunResponseDto>(
              await post('evaluations', {
                idempotencyKey: randomUUID(),
              }).expect(201),
            ),
          ).toMatchObject({ findingsCreated: 0, findingsUnchanged: 1 });
          const finding = body<ComplianceFindingResponseDto[]>(
            await get('findings?limit=1&offset=0').expect(200),
          )[0];
          expect(finding.ruleId).toBe(rule.id);
          expect(
            body<ComplianceFindingResponseDto[]>(
              await get('findings?limit=1&offset=1').expect(200),
            ),
          ).toEqual([]);
          expect(
            body<string[]>(await get('finding-categories').expect(200)),
          ).toEqual(['Calibration']);
          await get(`findings/${finding.id}`, 'other').expect(404);
          await patch(
            `findings/${finding.id}/status`,
            { status: 'RESOLVED', resolutionNote: 'Closed by reviewer.' },
            'reader',
          ).expect(403);
          await patch(`findings/${finding.id}/status`, {
            status: 'RESOLVED',
          }).expect(400);
          await patch(`controls/${control.id}`, {
            requirementIds: [second.id],
          }).expect(409);
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness').expect(200),
            ).overallScore,
          ).toBe(85);
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness', 'other').expect(200),
            ).overallScore,
          ).toBe(95);
          expect(
            body<{ recordId: string }>(
              await get(`sources/EQUIPMENT/${equipmentId}`).expect(200),
            ).recordId,
          ).toBe(equipmentId);
          await get(`sources/EQUIPMENT/${equipmentId}`, 'other').expect(404);
          await patch(`findings/${finding.id}/status`, {
            status: 'RESOLVED',
            resolutionNote: 'Manual closure for re-evaluation test.',
          }).expect(200);
          expect(
            body<ComplianceEvaluationRunResponseDto>(
              await post('evaluations', {
                idempotencyKey: randomUUID(),
              }).expect(201),
            ).findingsReopened,
          ).toBe(1);
          await patch(`findings/${finding.id}/status`, {
            status: 'ACCEPTED_RISK',
            resolutionNote: 'Risk accepted with documented monitoring.',
          }).expect(200);
          await post('evaluations', { idempotencyKey: randomUUID() }).expect(
            201,
          );
          expect(
            body<ComplianceFindingResponseDto>(
              await get(`findings/${finding.id}`).expect(200),
            ).status,
          ).toBe('ACCEPTED_RISK');
          await patch(`findings/${finding.id}/status`, {
            status: 'OPEN',
          }).expect(200);
          await patch(`rules/${rule.id}`, {
            name: 'Adjusted calibration verification',
            configuration: { minimumDaysOverdue: 365 },
          }).expect(200);
          const preservedRun = body<ComplianceEvaluationRunResponseDto>(
            await get(`evaluations/${firstRun.id}`).expect(200),
          );
          expect(preservedRun.results[0].rule.name).toBe('Calibration overdue');
          expect(preservedRun.results[0].ruleSnapshot).toMatchObject({
            configuration: { minimumDaysOverdue: 0 },
            severity: 'CRITICAL',
          });
          expect(
            body<ComplianceEvaluationRunResponseDto>(
              await post('evaluations', {
                idempotencyKey: randomUUID(),
              }).expect(201),
            ).findingsResolved,
          ).toBe(1);

          const snapshot = body<ComplianceScoreSnapshotResponseDto>(
            await post('readiness/snapshots', {}).expect(201),
          );
          expect(snapshot).toMatchObject({
            overallScore: 100,
            policyVersion: 1,
          });
          const policy = body<ComplianceReadinessPolicyResponseDto>(
            await patch('readiness/policy', {
              missingEvidencePenalty: 3,
            }).expect(200),
          );
          expect(policy.version).toBe(2);
          expect(
            body<ComplianceReadinessPolicyResponseDto>(
              await patch('readiness/policy', { minorPenalty: 3 }).expect(200),
            ).version,
          ).toBe(3);
          const history = body<ComplianceScoreSnapshotResponseDto[]>(
            await get('readiness/snapshots').expect(200),
          );
          expect(history[0]).toMatchObject({
            policyVersion: 1,
            overallScore: 100,
          });
          expect(history[0].frameworks).toHaveLength(1);
          expect(
            body<ComplianceScoreSnapshotResponseDto[]>(
              await get('readiness/snapshots', 'other').expect(200),
            ),
          ).toEqual([]);
          await patch('readiness/policy', { criticalPenalty: 1 }).expect(400);
          await patch('readiness/policy', { goodMinimum: 95 }).expect(400);
          await patch('readiness/policy', {
            frameworkWeights: { bad: 0 },
          }).expect(400);
          await patch('readiness/policy', { criticalPenalty: null }).expect(
            400,
          );
          await patch('readiness/policy', { categoryWeights: null }).expect(
            400,
          );
          await patch(`frameworks/${framework.id}`, { active: false }).expect(
            200,
          );
          await post('evaluations', { idempotencyKey: randomUUID() }).expect(
            400,
          );
          expect(
            body<ComplianceReadinessResponseDto>(
              await get('readiness').expect(200),
            ).overallScore,
          ).toBeNull();
          const privileges = await tx.$queryRaw<
            { can_update: boolean; can_delete: boolean }[]
          >`SELECT has_table_privilege('qualyra_runtime', 'compliance_score_snapshots', 'UPDATE') AS can_update, has_table_privilege('qualyra_runtime', 'compliance_score_snapshots', 'DELETE') AS can_delete`;
          expect(privileges[0]).toEqual({
            can_update: false,
            can_delete: false,
          });
          const policies = await tx.$queryRaw<
            { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
          >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('compliance_findings', 'compliance_evidence', 'compliance_score_snapshots', 'compliance_readiness_policies')`;
          expect(policies).toHaveLength(4);
          expect(
            policies.every(
              (value) => value.relrowsecurity && value.relforcerowsecurity,
            ),
          ).toBe(true);
          throw rollback;
        },
        { timeout: 120000 },
      )
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
  }, 130000);

  it('serializes tenant mutations without blocking a different tenant', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await owner.$transaction(async (tx) => {
        await lockComplianceTenant(tx, tenantA);
        expect(
          (
            await pool.query<{ acquired: boolean }>(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
              [`compliance:${tenantA}`],
            )
          ).rows[0].acquired,
        ).toBe(false);
        expect(
          (
            await pool.query<{ acquired: boolean }>(
              'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
              [`compliance:${tenantB}`],
            )
          ).rows[0].acquired,
        ).toBe(true);
      });
    } finally {
      await pool.end();
    }
  });

  async function fixture(tenantId: string, actor: string, codes: string[]) {
    await transaction.tenant.upsert({
      where: { id: tenantId },
      create: {
        id: tenantId,
        name: 'Compliance integration fixture',
        slug: `compliance-test-${tenantId}`,
        plan: 'ENTERPRISE',
      },
      update: {},
    });
    await transaction.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await transaction.tenantSubscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        status: 'ACTIVE',
        billingInterval: 'MONTHLY',
        currentPeriodStartsAt: new Date(),
      },
      update: {},
    });
    const user = await transaction.user.create({
      data: {
        tenantId,
        displayName: actor,
        email: `${actor}@compliance.test`,
        passwordHash: 'unused',
        status: 'ACTIVE',
      },
    });
    const role = await transaction.role.create({
      data: { tenantId, name: actor },
    });
    for (const code of codes) {
      const permission = await transaction.permission.findUniqueOrThrow({
        where: { code },
      });
      await transaction.rolePermission.create({
        data: { tenantId, roleId: role.id, permissionId: permission.id },
      });
    }
    await transaction.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id },
    });
    const session = await transaction.session.create({
      data: {
        tenantId,
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    principals.set(actor, {
      tenantId,
      userId: user.id,
      sessionId: session.id,
      tokenVersion: 0,
    });
  }
});

function body<T>(response: Response): T {
  return response.body as T;
}

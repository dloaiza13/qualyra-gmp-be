import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { equipmentAccessWhere } from '../../authorization/application/record-access.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CompleteCalibrationDto,
  CompleteMaintenanceDto,
  CreateEquipmentDto,
  EquipmentListQueryDto,
  RetireEquipmentDto,
  ReviewEquipmentRecordDto,
} from './dto/equipment-request.dto.js';
import type {
  EquipmentDetailResponseDto,
  EquipmentSummaryResponseDto,
} from './dto/equipment-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const equipmentInclude = {
  owner: { select: userSummary },
  verifier: { select: userSummary },
  createdBy: { select: userSummary },
  retiredBy: { select: userSummary },
  calibrations: {
    orderBy: { cycleNumber: 'desc' as const },
    include: {
      performedBy: { select: userSummary },
      review: { include: { reviewedBy: { select: userSummary } } },
    },
  },
  maintenances: {
    orderBy: { cycleNumber: 'desc' as const },
    include: {
      performedBy: { select: userSummary },
      review: { include: { reviewedBy: { select: userSummary } } },
    },
  },
} satisfies Prisma.EquipmentInclude;

type EquipmentRecord = Prisma.EquipmentGetPayload<{
  include: typeof equipmentInclude;
}>;

const equipmentPermissions = [
  'equipment.read',
  'equipment.create',
  'equipment.calibrate',
  'equipment.maintain',
  'equipment.verify',
  'equipment.retire',
];

@Injectable()
export class EquipmentService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  listParticipants(
    principal: AuthenticatedPrincipal,
  ): Promise<
    { id: string; displayName: string; email: string; permissions: string[] }[]
  > {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const users = await transaction.user.findMany({
          where: { tenantId: principal.tenantId, status: 'ACTIVE' },
          orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
          select: {
            ...userSummary,
            userRoles: {
              select: {
                role: {
                  select: {
                    name: true,
                    isSystem: true,
                    rolePermissions: {
                      select: { permission: { select: { code: true } } },
                    },
                  },
                },
              },
            },
          },
        });
        return users.map((user) => {
          const administrator = user.userRoles.some(
            ({ role }) => role.isSystem && role.name === 'Administrator',
          );
          const permissions = administrator
            ? equipmentPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('equipment.'));
          return {
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            permissions,
          };
        });
      },
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: EquipmentListQueryDto,
  ): Promise<EquipmentSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const records = await transaction.equipment.findMany({
          where: {
            tenantId: principal.tenantId,
            AND: [equipmentAccessWhere(principal)],
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { name: { contains: search, mode: 'insensitive' } },
                    {
                      serialNumber: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                    { location: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          include: equipmentInclude,
        });
        const now = new Date();
        return records.map((record) => mapSummary(record, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    equipmentId: string,
  ): Promise<EquipmentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readEquipment(
            transaction,
            principal.tenantId,
            equipmentId,
            equipmentAccessWhere(principal),
          ),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateEquipmentDto,
    request: RequestMetadata,
  ): Promise<EquipmentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        validatePlan(input);
        if (
          input.ownerUserId === input.verifierUserId ||
          input.verifierUserId === principal.userId
        ) {
          throw equipmentInvalid(
            'The verifier must be independent from the owner and creator.',
          );
        }
        await Promise.all([
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.ownerUserId,
            'equipment.calibrate',
            'equipment owner',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.ownerUserId,
            'equipment.maintain',
            'equipment owner',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.verifierUserId,
            'equipment.verify',
            'independent verifier',
          ),
        ]);
        const now = new Date();
        const sequence = await transaction.equipmentSequence.upsert({
          where: {
            tenantId_year: {
              tenantId: principal.tenantId,
              year: now.getUTCFullYear(),
            },
          },
          create: {
            tenantId: principal.tenantId,
            year: now.getUTCFullYear(),
            lastNumber: 1,
          },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `EQP-${now.getUTCFullYear()}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.equipment.create({
          data: {
            tenantId: principal.tenantId,
            code,
            name: input.name,
            category: input.category,
            criticality: input.criticality,
            manufacturer: input.manufacturer,
            model: input.model,
            serialNumber: input.serialNumber,
            location: input.location,
            processArea: input.processArea,
            intendedUse: input.intendedUse,
            ownerUserId: input.ownerUserId,
            verifierUserId: input.verifierUserId,
            createdByUserId: principal.userId,
            calibrationRequired: input.calibrationRequired,
            calibrationIntervalDays: input.calibrationIntervalDays,
            nextCalibrationAt: input.nextCalibrationAt
              ? new Date(input.nextCalibrationAt)
              : null,
            maintenanceRequired: input.maintenanceRequired,
            maintenanceIntervalDays: input.maintenanceIntervalDays,
            nextMaintenanceAt: input.nextMaintenanceAt
              ? new Date(input.nextMaintenanceAt)
              : null,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.ownerUserId,
          eventType: 'EQUIPMENT_REGISTERED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            equipmentId: created.id,
            code,
            criticality: input.criticality,
            verifierUserId: input.verifierUserId,
          },
        });
        return mapDetail(
          await readEquipment(transaction, principal.tenantId, created.id),
        );
      },
    );
  }

  async completeCalibration(
    principal: AuthenticatedPrincipal,
    equipmentId: string,
    input: CompleteCalibrationDto,
    request: RequestMetadata,
  ): Promise<EquipmentDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'CALIBRATION_REAUTHENTICATION_FAILED',
      { equipmentId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const equipment = await readEquipment(
          transaction,
          principal.tenantId,
          equipmentId,
        );
        assertOwnerMayService(equipment, principal.userId);
        if (!equipment.calibrationRequired || pendingService(equipment)) {
          throw equipmentConflict();
        }
        const id = randomUUID();
        const cycleNumber = equipment.calibrations.length + 1;
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          equipmentId,
          equipmentCode: equipment.code,
          cycleNumber,
          dueAtSnapshot: equipment.nextCalibrationAt?.toISOString() ?? null,
          result: input.result,
          certificateReference: input.certificateReference,
          standardReference: input.standardReference,
          readingsSummary: input.readingsSummary,
          performedByUserId: principal.userId,
          completionSessionId: principal.sessionId,
          meaning: 'CALIBRATION_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          performedAt: now.toISOString(),
        });
        await transaction.equipmentCalibration.create({
          data: {
            id,
            tenantId: principal.tenantId,
            equipmentId,
            cycleNumber,
            dueAtSnapshot: equipment.nextCalibrationAt,
            result: input.result,
            certificateReference: input.certificateReference,
            standardReference: input.standardReference,
            readingsSummary: input.readingsSummary,
            performedByUserId: principal.userId,
            completionSessionId: principal.sessionId,
            performedAt: now,
            recordHash,
          },
        });
        await markOutOfService(
          transaction,
          principal.tenantId,
          equipmentId,
          input.result === 'FAIL'
            ? 'Calibration result failed; independent review and remediation are required.'
            : 'Calibration is pending independent review.',
        );
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'EQUIPMENT_CALIBRATION_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            equipmentId,
            calibrationId: id,
            result: input.result,
            recordHash,
          },
        });
        return mapDetail(
          await readEquipment(transaction, principal.tenantId, equipmentId),
        );
      },
    );
  }

  async reviewCalibration(
    principal: AuthenticatedPrincipal,
    equipmentId: string,
    calibrationId: string,
    input: ReviewEquipmentRecordDto,
    request: RequestMetadata,
  ): Promise<EquipmentDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'CALIBRATION_REVIEW_REAUTHENTICATION_FAILED',
      { equipmentId, calibrationId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const equipment = await readEquipment(
          transaction,
          principal.tenantId,
          equipmentId,
        );
        const calibration = equipment.calibrations.find(
          ({ id }) => id === calibrationId,
        );
        assertVerifierMayReview(
          equipment,
          principal.userId,
          calibration?.status,
          calibration?.performedByUserId,
        );
        if (!calibration) throw equipmentNotFound('Calibration not found.');
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          equipmentId,
          calibrationId,
          sourceRecordHash: calibration.recordHash,
          decision: input.decision,
          rationale: input.rationale,
          reviewedByUserId: principal.userId,
          reviewSessionId: principal.sessionId,
          meaning: 'CALIBRATION_REVIEW',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          reviewedAt: now.toISOString(),
        });
        await transaction.equipmentCalibrationReview.create({
          data: {
            id,
            tenantId: principal.tenantId,
            calibrationId,
            decision: input.decision,
            rationale: input.rationale,
            reviewedByUserId: principal.userId,
            reviewSessionId: principal.sessionId,
            reviewedAt: now,
            recordHash,
          },
        });
        const status = input.decision === 'ACCEPT' ? 'COMPLETED' : 'REJECTED';
        const changed = await transaction.equipmentCalibration.updateMany({
          where: {
            id: calibrationId,
            tenantId: principal.tenantId,
            status: 'PENDING_REVIEW',
          },
          data: { status },
        });
        if (changed.count !== 1) throw equipmentConflict();
        const acceptedPass =
          input.decision === 'ACCEPT' && calibration.result === 'PASS';
        const nextCalibrationAt = acceptedPass
          ? addDays(now, requiredInterval(equipment.calibrationIntervalDays))
          : equipment.nextCalibrationAt;
        const canActivate =
          acceptedPass &&
          trackCurrent(
            equipment.maintenanceRequired,
            equipment.nextMaintenanceAt,
            now,
          ) &&
          !equipment.maintenances.some(
            ({ status: itemStatus }) => itemStatus === 'PENDING_REVIEW',
          );
        await transaction.equipment.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: equipmentId },
          },
          data: {
            nextCalibrationAt,
            status: canActivate ? 'ACTIVE' : 'OUT_OF_SERVICE',
            outOfServiceReason: canActivate
              ? null
              : input.decision === 'REJECT'
                ? 'Calibration review was rejected.'
                : calibration.result === 'FAIL'
                  ? 'Calibration failed; corrective action is required.'
                  : 'Another required service track is not current.',
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'EQUIPMENT_CALIBRATION_REVIEWED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            equipmentId,
            calibrationId,
            decision: input.decision,
            recordHash,
          },
        });
        return mapDetail(
          await readEquipment(transaction, principal.tenantId, equipmentId),
        );
      },
    );
  }

  async completeMaintenance(
    principal: AuthenticatedPrincipal,
    equipmentId: string,
    input: CompleteMaintenanceDto,
    request: RequestMetadata,
  ): Promise<EquipmentDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'MAINTENANCE_REAUTHENTICATION_FAILED',
      { equipmentId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const equipment = await readEquipment(
          transaction,
          principal.tenantId,
          equipmentId,
        );
        assertOwnerMayService(equipment, principal.userId);
        if (
          pendingService(equipment) ||
          (input.type === 'PREVENTIVE' && !equipment.maintenanceRequired)
        ) {
          throw equipmentConflict();
        }
        const id = randomUUID();
        const cycleNumber = equipment.maintenances.length + 1;
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          equipmentId,
          equipmentCode: equipment.code,
          cycleNumber,
          type: input.type,
          dueAtSnapshot: equipment.nextMaintenanceAt?.toISOString() ?? null,
          workOrderReference: input.workOrderReference,
          workPerformed: input.workPerformed,
          partsAndMaterials: input.partsAndMaterials,
          evidenceReference: input.evidenceReference,
          result: input.result,
          performedByUserId: principal.userId,
          completionSessionId: principal.sessionId,
          meaning: 'MAINTENANCE_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          performedAt: now.toISOString(),
        });
        await transaction.equipmentMaintenance.create({
          data: {
            id,
            tenantId: principal.tenantId,
            equipmentId,
            cycleNumber,
            type: input.type,
            dueAtSnapshot: equipment.nextMaintenanceAt,
            workOrderReference: input.workOrderReference,
            workPerformed: input.workPerformed,
            partsAndMaterials: input.partsAndMaterials,
            evidenceReference: input.evidenceReference,
            result: input.result,
            performedByUserId: principal.userId,
            completionSessionId: principal.sessionId,
            performedAt: now,
            recordHash,
          },
        });
        await markOutOfService(
          transaction,
          principal.tenantId,
          equipmentId,
          input.result === 'UNSATISFACTORY'
            ? 'Maintenance result was unsatisfactory.'
            : 'Maintenance is pending independent review.',
        );
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'EQUIPMENT_MAINTENANCE_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            equipmentId,
            maintenanceId: id,
            type: input.type,
            result: input.result,
            recordHash,
          },
        });
        return mapDetail(
          await readEquipment(transaction, principal.tenantId, equipmentId),
        );
      },
    );
  }

  async reviewMaintenance(
    principal: AuthenticatedPrincipal,
    equipmentId: string,
    maintenanceId: string,
    input: ReviewEquipmentRecordDto,
    request: RequestMetadata,
  ): Promise<EquipmentDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'MAINTENANCE_REVIEW_REAUTHENTICATION_FAILED',
      { equipmentId, maintenanceId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const equipment = await readEquipment(
          transaction,
          principal.tenantId,
          equipmentId,
        );
        const maintenance = equipment.maintenances.find(
          ({ id }) => id === maintenanceId,
        );
        assertVerifierMayReview(
          equipment,
          principal.userId,
          maintenance?.status,
          maintenance?.performedByUserId,
        );
        if (!maintenance) throw equipmentNotFound('Maintenance not found.');
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          equipmentId,
          maintenanceId,
          sourceRecordHash: maintenance.recordHash,
          decision: input.decision,
          rationale: input.rationale,
          reviewedByUserId: principal.userId,
          reviewSessionId: principal.sessionId,
          meaning: 'MAINTENANCE_REVIEW',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          reviewedAt: now.toISOString(),
        });
        await transaction.equipmentMaintenanceReview.create({
          data: {
            id,
            tenantId: principal.tenantId,
            maintenanceId,
            decision: input.decision,
            rationale: input.rationale,
            reviewedByUserId: principal.userId,
            reviewSessionId: principal.sessionId,
            reviewedAt: now,
            recordHash,
          },
        });
        const status = input.decision === 'ACCEPT' ? 'COMPLETED' : 'REJECTED';
        const changed = await transaction.equipmentMaintenance.updateMany({
          where: {
            id: maintenanceId,
            tenantId: principal.tenantId,
            status: 'PENDING_REVIEW',
          },
          data: { status },
        });
        if (changed.count !== 1) throw equipmentConflict();
        const acceptedSatisfactory =
          input.decision === 'ACCEPT' && maintenance.result === 'SATISFACTORY';
        const nextMaintenanceAt =
          acceptedSatisfactory && equipment.maintenanceRequired
            ? addDays(now, requiredInterval(equipment.maintenanceIntervalDays))
            : equipment.nextMaintenanceAt;
        const canActivate =
          acceptedSatisfactory &&
          trackCurrent(
            equipment.calibrationRequired,
            equipment.nextCalibrationAt,
            now,
          ) &&
          !equipment.calibrations.some(
            ({ status: itemStatus }) => itemStatus === 'PENDING_REVIEW',
          );
        await transaction.equipment.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: equipmentId },
          },
          data: {
            nextMaintenanceAt,
            status: canActivate ? 'ACTIVE' : 'OUT_OF_SERVICE',
            outOfServiceReason: canActivate
              ? null
              : input.decision === 'REJECT'
                ? 'Maintenance review was rejected.'
                : maintenance.result === 'UNSATISFACTORY'
                  ? 'Maintenance was unsatisfactory; remediation is required.'
                  : 'Another required service track is not current.',
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'EQUIPMENT_MAINTENANCE_REVIEWED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            equipmentId,
            maintenanceId,
            decision: input.decision,
            recordHash,
          },
        });
        return mapDetail(
          await readEquipment(transaction, principal.tenantId, equipmentId),
        );
      },
    );
  }

  async retire(
    principal: AuthenticatedPrincipal,
    equipmentId: string,
    input: RetireEquipmentDto,
    request: RequestMetadata,
  ): Promise<EquipmentDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'EQUIPMENT_RETIREMENT_REAUTHENTICATION_FAILED',
      { equipmentId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const equipment = await readEquipment(
          transaction,
          principal.tenantId,
          equipmentId,
        );
        if (
          equipment.verifierUserId !== principal.userId ||
          equipment.status === 'RETIRED' ||
          pendingService(equipment)
        ) {
          throw equipmentForbidden(
            'Only the independent verifier can retire equipment without pending reviews.',
          );
        }
        const retirementRecordHash = hashRecord({
          schemaVersion: 1,
          equipmentId,
          equipmentCode: equipment.code,
          reason: input.reason,
          retiredByUserId: principal.userId,
          retirementSessionId: principal.sessionId,
          meaning: 'EQUIPMENT_RETIREMENT',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          retiredAt: now.toISOString(),
        });
        await transaction.equipment.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: equipmentId },
          },
          data: {
            status: 'RETIRED',
            outOfServiceReason: 'Equipment has been retired from GMP use.',
            retiredByUserId: principal.userId,
            retirementSessionId: principal.sessionId,
            retirementReason: input.reason,
            retiredAt: now,
            retirementRecordHash,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'EQUIPMENT_RETIRED',
          outcome: 'SUCCESS',
          request,
          metadata: { equipmentId, code: equipment.code, retirementRecordHash },
        });
        return mapDetail(
          await readEquipment(transaction, principal.tenantId, equipmentId),
        );
      },
    );
  }

  private async reauthenticate(
    principal: AuthenticatedPrincipal,
    password: string,
    request: RequestMetadata,
    failureEvent: string,
    metadata: Record<string, string>,
  ): Promise<string> {
    const signer = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.user.findFirst({
          where: {
            id: principal.userId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: { passwordHash: true },
        }),
    );
    const valid =
      signer &&
      (await this.passwordHasher.verify(signer.passwordHash, password));
    if (!valid) {
      await this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
        appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: failureEvent,
          outcome: 'FAILURE',
          request,
          metadata,
        }),
      );
      throw reauthenticationFailed();
    }
    return signer.passwordHash;
  }
}

async function readEquipment(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  equipmentId: string,
  accessWhere: Prisma.EquipmentWhereInput = {},
): Promise<EquipmentRecord> {
  const equipment = await transaction.equipment.findFirst({
    where: { id: equipmentId, tenantId, AND: [accessWhere] },
    include: equipmentInclude,
  });
  if (!equipment) throw equipmentNotFound();
  return equipment;
}

async function assertEligibleUser(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  permissionCode: string,
  label: string,
): Promise<void> {
  const user = await transaction.user.findFirst({
    where: {
      id: userId,
      tenantId,
      status: 'ACTIVE',
      userRoles: {
        some: {
          role: {
            OR: [
              { name: 'Administrator', isSystem: true },
              {
                rolePermissions: {
                  some: { permission: { code: permissionCode } },
                },
              },
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  if (!user) {
    throw equipmentInvalid(
      `The ${label} must be active and have the required permission.`,
    );
  }
}

async function assertCurrentSigner(
  transaction: Prisma.TransactionClient,
  principal: AuthenticatedPrincipal,
  passwordHash: string,
  now: Date,
): Promise<void> {
  const [user, session] = await Promise.all([
    transaction.user.findFirst({
      where: {
        id: principal.userId,
        tenantId: principal.tenantId,
        status: 'ACTIVE',
      },
      select: { passwordHash: true },
    }),
    transaction.session.findFirst({
      where: {
        id: principal.sessionId,
        tenantId: principal.tenantId,
        userId: principal.userId,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      select: { id: true },
    }),
  ]);
  if (!user || user.passwordHash !== passwordHash || !session) {
    throw reauthenticationFailed();
  }
}

function validatePlan(input: CreateEquipmentDto): void {
  const now = Date.now();
  const calibrationDate = input.nextCalibrationAt
    ? new Date(input.nextCalibrationAt)
    : null;
  const maintenanceDate = input.nextMaintenanceAt
    ? new Date(input.nextMaintenanceAt)
    : null;
  if (
    input.calibrationRequired !==
      Boolean(input.calibrationIntervalDays && calibrationDate) ||
    input.maintenanceRequired !==
      Boolean(input.maintenanceIntervalDays && maintenanceDate) ||
    (calibrationDate && calibrationDate.getTime() <= now) ||
    (maintenanceDate && maintenanceDate.getTime() <= now)
  ) {
    throw equipmentInvalid(
      'Each required service track needs an interval and a future due date; non-required tracks must omit both.',
    );
  }
}

function pendingService(equipment: EquipmentRecord): boolean {
  return (
    equipment.calibrations.some(({ status }) => status === 'PENDING_REVIEW') ||
    equipment.maintenances.some(({ status }) => status === 'PENDING_REVIEW')
  );
}

function assertOwnerMayService(
  equipment: EquipmentRecord,
  userId: string,
): void {
  if (equipment.ownerUserId !== userId || equipment.status === 'RETIRED') {
    throw equipmentForbidden(
      'Only the assigned equipment owner can sign service completion.',
    );
  }
}

function assertVerifierMayReview(
  equipment: EquipmentRecord,
  userId: string,
  status?: string,
  performedByUserId?: string,
): void {
  if (
    equipment.verifierUserId !== userId ||
    performedByUserId === userId ||
    status !== 'PENDING_REVIEW'
  ) {
    throw equipmentForbidden(
      'Only the assigned independent verifier can sign this review.',
    );
  }
}

async function markOutOfService(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  equipmentId: string,
  reason: string,
): Promise<void> {
  await transaction.equipment.update({
    where: { tenantId_id: { tenantId, id: equipmentId } },
    data: { status: 'OUT_OF_SERVICE', outOfServiceReason: reason },
  });
}

function requiredInterval(interval: number | null): number {
  if (!interval) throw equipmentConflict();
  return interval;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function trackCurrent(
  required: boolean,
  dueAt: Date | null,
  now: Date,
): boolean {
  return !required || Boolean(dueAt && dueAt.getTime() > now.getTime());
}

function mapSummary(
  equipment: EquipmentRecord,
  now = new Date(),
): EquipmentSummaryResponseDto {
  const calibrationState = dueState(
    equipment.calibrationRequired,
    equipment.nextCalibrationAt,
    now,
  );
  const maintenanceState = dueState(
    equipment.maintenanceRequired,
    equipment.nextMaintenanceAt,
    now,
  );
  const pending = pendingService(equipment);
  const complianceState =
    equipment.status === 'RETIRED'
      ? 'RETIRED'
      : pending
        ? 'PENDING_REVIEW'
        : equipment.status === 'OUT_OF_SERVICE'
          ? 'OUT_OF_SERVICE'
          : calibrationState === 'OVERDUE'
            ? 'CALIBRATION_OVERDUE'
            : maintenanceState === 'OVERDUE'
              ? 'MAINTENANCE_OVERDUE'
              : calibrationState === 'DUE_SOON' ||
                  maintenanceState === 'DUE_SOON'
                ? 'DUE_SOON'
                : 'CURRENT';
  return {
    id: equipment.id,
    code: equipment.code,
    name: equipment.name,
    category: equipment.category,
    criticality: equipment.criticality,
    manufacturer: equipment.manufacturer,
    model: equipment.model,
    serialNumber: equipment.serialNumber,
    location: equipment.location,
    processArea: equipment.processArea,
    status: equipment.status,
    approvedForUse:
      equipment.status === 'ACTIVE' &&
      !pending &&
      calibrationState !== 'OVERDUE' &&
      maintenanceState !== 'OVERDUE',
    complianceState,
    calibrationRequired: equipment.calibrationRequired,
    nextCalibrationAt: equipment.nextCalibrationAt?.toISOString() ?? null,
    maintenanceRequired: equipment.maintenanceRequired,
    nextMaintenanceAt: equipment.nextMaintenanceAt?.toISOString() ?? null,
    owner: equipment.owner,
    verifier: equipment.verifier,
    createdAt: equipment.createdAt.toISOString(),
  };
}

function mapDetail(equipment: EquipmentRecord): EquipmentDetailResponseDto {
  return {
    ...mapSummary(equipment),
    intendedUse: equipment.intendedUse,
    outOfServiceReason: equipment.outOfServiceReason,
    retirementReason: equipment.retirementReason,
    retiredAt: equipment.retiredAt?.toISOString() ?? null,
    retirementRecordHash: equipment.retirementRecordHash,
    calibrationIntervalDays: equipment.calibrationIntervalDays,
    maintenanceIntervalDays: equipment.maintenanceIntervalDays,
    createdBy: equipment.createdBy,
    calibrations: equipment.calibrations.map((record) => ({
      id: record.id,
      cycleNumber: record.cycleNumber,
      dueAtSnapshot: record.dueAtSnapshot?.toISOString() ?? null,
      result: record.result,
      certificateReference: record.certificateReference,
      standardReference: record.standardReference,
      readingsSummary: record.readingsSummary,
      performedBy: record.performedBy,
      meaning: record.meaning,
      authenticationMethod: record.authenticationMethod,
      performedAt: record.performedAt.toISOString(),
      recordHash: record.recordHash,
      status: record.status,
      review: record.review
        ? {
            decision: record.review.decision,
            rationale: record.review.rationale,
            reviewedBy: record.review.reviewedBy,
            meaning: record.review.meaning,
            authenticationMethod: record.review.authenticationMethod,
            reviewedAt: record.review.reviewedAt.toISOString(),
            recordHash: record.review.recordHash,
          }
        : null,
    })),
    maintenances: equipment.maintenances.map((record) => ({
      id: record.id,
      cycleNumber: record.cycleNumber,
      type: record.type,
      dueAtSnapshot: record.dueAtSnapshot?.toISOString() ?? null,
      workOrderReference: record.workOrderReference,
      workPerformed: record.workPerformed,
      partsAndMaterials: record.partsAndMaterials,
      evidenceReference: record.evidenceReference,
      result: record.result,
      performedBy: record.performedBy,
      meaning: record.meaning,
      authenticationMethod: record.authenticationMethod,
      performedAt: record.performedAt.toISOString(),
      recordHash: record.recordHash,
      status: record.status,
      review: record.review
        ? {
            decision: record.review.decision,
            rationale: record.review.rationale,
            reviewedBy: record.review.reviewedBy,
            meaning: record.review.meaning,
            authenticationMethod: record.review.authenticationMethod,
            reviewedAt: record.review.reviewedAt.toISOString(),
            recordHash: record.review.recordHash,
          }
        : null,
    })),
  };
}

function dueState(
  required: boolean,
  dueAt: Date | null,
  now: Date,
): 'NOT_REQUIRED' | 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' {
  if (!required) return 'NOT_REQUIRED';
  if (!dueAt || dueAt.getTime() < now.getTime()) return 'OVERDUE';
  return dueAt.getTime() <= now.getTime() + 30 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function equipmentNotFound(
  message = 'The equipment was not found.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.EquipmentNotFound,
    message,
    HttpStatus.NOT_FOUND,
  );
}

function equipmentInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.EquipmentInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function equipmentConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.EquipmentConflict,
    'The equipment record changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function equipmentForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.EquipmentForbidden,
    message,
    HttpStatus.FORBIDDEN,
  );
}

function reauthenticationFailed(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ReauthenticationFailed,
    'Reauthentication failed.',
    HttpStatus.FORBIDDEN,
  );
}

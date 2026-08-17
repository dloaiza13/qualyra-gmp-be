import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CancelDeviationDto,
  CompleteDeviationInvestigationDto,
  CreateDeviationDto,
  DeviationListQueryDto,
  TriageDeviationDto,
} from './dto/deviation-request.dto.js';
import type {
  DeviationDetailResponseDto,
  DeviationSummaryResponseDto,
} from './dto/deviation-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const deviationInclude = {
  reportedByUser: { select: userSummary },
  investigatorUser: { select: userSummary },
  triagedByUser: { select: userSummary },
  cancelledByUser: { select: userSummary },
  investigation: {
    include: { completedByUser: { select: userSummary } },
  },
  capa: {
    include: {
      effectivenessReviews: {
        orderBy: { cycleNumber: 'desc' as const },
        take: 1,
        include: { assignedToUser: { select: userSummary } },
      },
    },
  },
} satisfies Prisma.DeviationInclude;
type DeviationRecord = Prisma.DeviationGetPayload<{
  include: typeof deviationInclude;
}>;

@Injectable()
export class DeviationsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  list(
    principal: AuthenticatedPrincipal,
    query: DeviationListQueryDto,
  ): Promise<DeviationSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const deviations = await transaction.deviation.findMany({
          where: {
            tenantId: principal.tenantId,
            status: query.status,
            severity: query.severity,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    { area: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: deviationInclude,
        });
        const now = new Date();
        return deviations.map((deviation) => mapSummary(deviation, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    deviationId: string,
  ): Promise<DeviationDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readDeviation(transaction, principal.tenantId, deviationId),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateDeviationDto,
    request: RequestMetadata,
  ): Promise<DeviationDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const occurredAt = new Date(input.occurredAt);
        if (occurredAt.getTime() > now.getTime()) {
          throw deviationInvalid(
            'The occurrence time cannot be in the future.',
          );
        }

        const year = now.getUTCFullYear();
        const sequence = await transaction.deviationSequence.upsert({
          where: {
            tenantId_year: { tenantId: principal.tenantId, year },
          },
          create: {
            tenantId: principal.tenantId,
            year,
            lastNumber: 1,
          },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `DEV-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const deviation = await transaction.deviation.create({
          data: {
            tenantId: principal.tenantId,
            code,
            title: input.title,
            description: input.description,
            area: input.area,
            occurredAt,
            reportedByUserId: principal.userId,
          },
          include: deviationInclude,
        });

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'DEVIATION_REPORTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            deviationId: deviation.id,
            code,
            area: deviation.area,
            occurredAt: occurredAt.toISOString(),
          },
        });
        return mapDetail(deviation);
      },
    );
  }

  triage(
    principal: AuthenticatedPrincipal,
    deviationId: string,
    input: TriageDeviationDto,
    request: RequestMetadata,
  ): Promise<DeviationDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const investigationDueAt = new Date(input.investigationDueAt);
        if (investigationDueAt.getTime() <= now.getTime()) {
          throw deviationInvalid(
            'The investigation due date must be in the future.',
          );
        }

        const deviation = await transaction.deviation.findFirst({
          where: { id: deviationId, tenantId: principal.tenantId },
          select: { id: true, code: true, status: true },
        });
        if (!deviation) throw deviationNotFound();
        if (deviation.status !== 'REPORTED') throw deviationConflict();

        const investigator = await transaction.user.findFirst({
          where: {
            id: input.investigatorUserId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
            userRoles: {
              some: {
                role: {
                  rolePermissions: {
                    some: { permission: { code: 'deviations.investigate' } },
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        if (!investigator) {
          throw deviationInvalid(
            'The investigator must be active and permitted to investigate deviations.',
          );
        }

        const updated = await transaction.deviation.updateMany({
          where: {
            id: deviation.id,
            tenantId: principal.tenantId,
            status: 'REPORTED',
          },
          data: {
            status: 'UNDER_INVESTIGATION',
            severity: input.severity,
            investigatorUserId: investigator.id,
            investigationDueAt,
            impactAssessment: input.impactAssessment,
            containmentAction: input.containmentAction,
            triagedByUserId: principal.userId,
            triagedAt: now,
          },
        });
        if (updated.count !== 1) throw deviationConflict();

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: investigator.id,
          eventType: 'DEVIATION_TRIAGED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            deviationId: deviation.id,
            code: deviation.code,
            severity: input.severity,
            investigatorUserId: investigator.id,
            investigationDueAt: investigationDueAt.toISOString(),
          },
        });
        return mapDetail(
          await readDeviation(transaction, principal.tenantId, deviation.id),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    deviationId: string,
    input: CancelDeviationDto,
    request: RequestMetadata,
  ): Promise<DeviationDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const deviation = await transaction.deviation.findFirst({
          where: { id: deviationId, tenantId: principal.tenantId },
          select: { id: true, code: true, status: true },
        });
        if (!deviation) throw deviationNotFound();
        if (deviation.status !== 'REPORTED') throw deviationConflict();
        const now = new Date();
        const cancelled = await transaction.deviation.updateMany({
          where: {
            id: deviation.id,
            tenantId: principal.tenantId,
            status: 'REPORTED',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancelledAt: now,
            cancellationReason: input.reason,
          },
        });
        if (cancelled.count !== 1) throw deviationConflict();

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'DEVIATION_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            deviationId: deviation.id,
            code: deviation.code,
            reason: input.reason,
          },
        });
        return mapDetail(
          await readDeviation(transaction, principal.tenantId, deviation.id),
        );
      },
    );
  }

  async completeInvestigation(
    principal: AuthenticatedPrincipal,
    deviationId: string,
    input: CompleteDeviationInvestigationDto,
    request: RequestMetadata,
  ): Promise<DeviationDetailResponseDto> {
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
    const passwordMatches = signer
      ? await this.passwordHasher
          .verify(signer.passwordHash, input.password)
          .catch(() => false)
      : false;
    if (!passwordMatches) {
      await this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
        appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'DEVIATION_INVESTIGATION_REAUTHENTICATION_FAILED',
          outcome: 'FAILURE',
          request,
          metadata: { deviationId },
        }),
      );
      throw reauthenticationFailed();
    }

    try {
      return await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          const now = new Date();
          const deviation = await readDeviation(
            transaction,
            principal.tenantId,
            deviationId,
          );
          if (deviation.status !== 'UNDER_INVESTIGATION') {
            throw deviationConflict();
          }
          if (deviation.investigatorUserId !== principal.userId) {
            throw investigationForbidden();
          }

          const currentSigner = await transaction.user.findFirst({
            where: {
              id: principal.userId,
              tenantId: principal.tenantId,
              status: 'ACTIVE',
            },
            select: { passwordHash: true },
          });
          const session = await transaction.session.findFirst({
            where: {
              id: principal.sessionId,
              tenantId: principal.tenantId,
              userId: principal.userId,
              status: 'ACTIVE',
              expiresAt: { gt: now },
            },
            select: { id: true },
          });
          if (
            !currentSigner ||
            currentSigner.passwordHash !== signer?.passwordHash ||
            !session
          ) {
            throw reauthenticationFailed();
          }

          const investigationId = randomUUID();
          const recordHash = hashRecord({
            schemaVersion: 1,
            investigationId,
            deviationId: deviation.id,
            deviationCode: deviation.code,
            title: deviation.title,
            occurredAt: deviation.occurredAt.toISOString(),
            reportedByUserId: deviation.reportedByUserId,
            severity: deviation.severity,
            investigatorUserId: deviation.investigatorUserId,
            investigationDueAt: deviation.investigationDueAt?.toISOString(),
            impactAssessment: deviation.impactAssessment,
            containmentAction: deviation.containmentAction,
            method: input.method,
            problemStatement: input.problemStatement,
            chronology: input.chronology,
            immediateCause: input.immediateCause,
            rootCause: input.rootCause,
            contributingFactors: input.contributingFactors,
            productImpact: input.productImpact,
            requiresCapa: input.requiresCapa,
            capaRationale: input.capaRationale,
            completedByUserId: principal.userId,
            sessionId: principal.sessionId,
            meaning: 'INVESTIGATION_COMPLETION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            attestationAccepted: true,
            completedAt: now.toISOString(),
          });

          await transaction.deviationInvestigation.create({
            data: {
              id: investigationId,
              tenantId: principal.tenantId,
              deviationId: deviation.id,
              method: input.method,
              problemStatement: input.problemStatement,
              chronology: input.chronology,
              immediateCause: input.immediateCause,
              rootCause: input.rootCause,
              contributingFactors: input.contributingFactors,
              productImpact: input.productImpact,
              requiresCapa: input.requiresCapa,
              capaRationale: input.capaRationale,
              completedByUserId: principal.userId,
              completionSessionId: principal.sessionId,
              meaning: 'INVESTIGATION_COMPLETION',
              authenticationMethod: 'PASSWORD_REAUTHENTICATION',
              completedAt: now,
              recordHash,
            },
          });

          const completed = await transaction.deviation.updateMany({
            where: {
              id: deviation.id,
              tenantId: principal.tenantId,
              status: 'UNDER_INVESTIGATION',
              investigatorUserId: principal.userId,
            },
            data: { status: 'INVESTIGATION_COMPLETED' },
          });
          if (completed.count !== 1) throw deviationConflict();

          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: principal.userId,
            eventType: 'DEVIATION_INVESTIGATION_COMPLETED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              deviationId: deviation.id,
              code: deviation.code,
              method: input.method,
              requiresCapa: input.requiresCapa,
              meaning: 'INVESTIGATION_COMPLETION',
              authenticationMethod: 'PASSWORD_REAUTHENTICATION',
              recordHash,
            },
          });
          return mapDetail(
            await readDeviation(transaction, principal.tenantId, deviation.id),
          );
        },
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) throw deviationConflict();
      throw error;
    }
  }
}

async function readDeviation(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  deviationId: string,
): Promise<DeviationRecord> {
  const deviation = await transaction.deviation.findFirst({
    where: { id: deviationId, tenantId },
    include: deviationInclude,
  });
  if (!deviation) throw deviationNotFound();
  return deviation;
}

function mapSummary(
  deviation: DeviationRecord,
  now = new Date(),
): DeviationSummaryResponseDto {
  return {
    id: deviation.id,
    code: deviation.code,
    title: deviation.title,
    area: deviation.area,
    occurredAt: deviation.occurredAt.toISOString(),
    status: deviation.status,
    severity: deviation.severity,
    dueState: dueState(deviation.investigationDueAt, now, deviation.status),
    reportedBy: deviation.reportedByUser,
    investigator: deviation.investigatorUser,
    investigationDueAt: deviation.investigationDueAt?.toISOString() ?? null,
    requiresCapa: deviation.investigation?.requiresCapa ?? null,
    investigationCompletedAt:
      deviation.investigation?.completedAt.toISOString() ?? null,
    createdAt: deviation.createdAt.toISOString(),
  };
}

function mapDetail(deviation: DeviationRecord): DeviationDetailResponseDto {
  return {
    ...mapSummary(deviation),
    description: deviation.description,
    impactAssessment: deviation.impactAssessment,
    containmentAction: deviation.containmentAction,
    triagedBy: deviation.triagedByUser,
    triagedAt: deviation.triagedAt?.toISOString() ?? null,
    cancelledBy: deviation.cancelledByUser,
    cancelledAt: deviation.cancelledAt?.toISOString() ?? null,
    cancellationReason: deviation.cancellationReason,
    investigation: deviation.investigation
      ? {
          id: deviation.investigation.id,
          method: deviation.investigation.method,
          problemStatement: deviation.investigation.problemStatement,
          chronology: deviation.investigation.chronology,
          immediateCause: deviation.investigation.immediateCause,
          rootCause: deviation.investigation.rootCause,
          contributingFactors: deviation.investigation.contributingFactors,
          productImpact: deviation.investigation.productImpact,
          requiresCapa: deviation.investigation.requiresCapa,
          capaRationale: deviation.investigation.capaRationale,
          completedBy: deviation.investigation.completedByUser,
          meaning: deviation.investigation.meaning,
          authenticationMethod: deviation.investigation.authenticationMethod,
          completedAt: deviation.investigation.completedAt.toISOString(),
          recordHash: deviation.investigation.recordHash,
        }
      : null,
    closure:
      deviation.status === 'CLOSED' &&
      deviation.capa?.effectivenessReviews[0]?.status === 'COMPLETED' &&
      deviation.capa.effectivenessReviews[0].decision === 'EFFECTIVE' &&
      deviation.capa.effectivenessReviews[0].completedAt &&
      deviation.capa.effectivenessReviews[0].recordHash
        ? {
            capaId: deviation.capa.id,
            capaCode: deviation.capa.code,
            effectivenessReviewId: deviation.capa.effectivenessReviews[0].id,
            closedBy: deviation.capa.effectivenessReviews[0].assignedToUser,
            decision: 'EFFECTIVE',
            closedAt:
              deviation.capa.effectivenessReviews[0].completedAt.toISOString(),
            recordHash: deviation.capa.effectivenessReviews[0].recordHash,
          }
        : null,
  };
}

function dueState(
  dueAt: Date | null,
  now: Date,
  status: string,
): 'NOT_APPLICABLE' | 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (status === 'INVESTIGATION_COMPLETED' || status === 'CLOSED')
    return 'COMPLETED';
  if (!dueAt) return 'NOT_APPLICABLE';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  const dueSoonThreshold = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  return dueAt.getTime() <= dueSoonThreshold ? 'DUE_SOON' : 'ON_TRACK';
}

function deviationNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DeviationNotFound,
    'The deviation was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function deviationInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DeviationInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function deviationConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DeviationConflict,
    'The deviation changed. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function investigationForbidden(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DeviationInvestigationForbidden,
    'Only the assigned investigator can complete this investigation.',
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

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002',
  );
}

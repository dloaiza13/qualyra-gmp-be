import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CancelDeviationDto,
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
} satisfies Prisma.DeviationInclude;
type DeviationRecord = Prisma.DeviationGetPayload<{
  include: typeof deviationInclude;
}>;

@Injectable()
export class DeviationsService {
  constructor(private readonly tenantUnitOfWork: TenantUnitOfWork) {}

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
                    some: { permission: { code: 'deviations.read' } },
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        if (!investigator) {
          throw deviationInvalid(
            'The investigator must be active and able to read deviations.',
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
    dueState: dueState(deviation.investigationDueAt, now),
    reportedBy: deviation.reportedByUser,
    investigator: deviation.investigatorUser,
    investigationDueAt: deviation.investigationDueAt?.toISOString() ?? null,
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
  };
}

function dueState(
  dueAt: Date | null,
  now: Date,
): 'NOT_APPLICABLE' | 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' {
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

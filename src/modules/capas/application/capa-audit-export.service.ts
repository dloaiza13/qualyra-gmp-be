import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type { CapaAuditExportResponseDto } from './dto/capa-response.dto.js';

const auditInclude = {
  tenant: { select: { id: true, name: true, slug: true } },
  deviation: {
    include: {
      reportedByUser: { select: { id: true, displayName: true, email: true } },
      investigatorUser: {
        select: { id: true, displayName: true, email: true },
      },
      triagedByUser: { select: { id: true, displayName: true, email: true } },
    },
  },
  investigation: {
    include: {
      completedByUser: { select: { id: true, displayName: true, email: true } },
    },
  },
  createdByUser: { select: { id: true, displayName: true, email: true } },
  actions: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      assignedToUser: { select: { id: true, displayName: true, email: true } },
      extensions: {
        orderBy: [{ approvedAt: 'asc' as const }, { id: 'asc' as const }],
        include: {
          approvedByUser: {
            select: { id: true, displayName: true, email: true },
          },
        },
      },
      evidenceReferences: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
        include: { evidenceUpload: true },
      },
    },
  },
  effectivenessReviews: {
    orderBy: [{ cycleNumber: 'asc' as const }, { id: 'asc' as const }],
    include: {
      assignedToUser: { select: { id: true, displayName: true, email: true } },
      scheduledByUser: { select: { id: true, displayName: true, email: true } },
    },
  },
  followUpCycles: {
    orderBy: [{ cycleNumber: 'asc' as const }, { id: 'asc' as const }],
    include: {
      createdByUser: { select: { id: true, displayName: true, email: true } },
    },
  },
  notifications: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      recipientUser: { select: { id: true, displayName: true, email: true } },
    },
  },
} satisfies Prisma.CapaInclude;

@Injectable()
export class CapaAuditExportService {
  constructor(private readonly tenantUnitOfWork: TenantUnitOfWork) {}

  create(
    principal: AuthenticatedPrincipal,
    capaId: string,
    request: RequestMetadata,
  ): Promise<CapaAuditExportResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const [capa, exportedBy] = await Promise.all([
          transaction.capa.findFirst({
            where: { id: capaId, tenantId: principal.tenantId },
            include: auditInclude,
          }),
          transaction.user.findFirst({
            where: { id: principal.userId, tenantId: principal.tenantId },
            select: { id: true, displayName: true, email: true },
          }),
        ]);
        if (!capa || !exportedBy) {
          throw new ApplicationError(
            ErrorCode.CapaNotFound,
            'The CAPA record was not found.',
            HttpStatus.NOT_FOUND,
          );
        }

        const id = randomUUID();
        const generatedAt = new Date();
        const schemaVersion = 'qualyra.capa.audit.v1';
        const fileName = `${capa.code}-${generatedAt.toISOString().replaceAll(':', '-')}.json`;
        const recordCount =
          3 +
          capa.actions.length +
          capa.actions.reduce(
            (count, action) =>
              count +
              action.extensions.length +
              action.evidenceReferences.length,
            0,
          ) +
          capa.effectivenessReviews.length +
          capa.followUpCycles.length +
          capa.notifications.length;
        const payload = normalizeJson({
          schemaVersion,
          export: {
            id,
            format: 'JSON',
            generatedAt,
            generatedBy: exportedBy,
          },
          tenant: capa.tenant,
          capa: {
            id: capa.id,
            code: capa.code,
            title: capa.title,
            objective: capa.objective,
            createdAt: capa.createdAt,
            lockedAt: capa.lockedAt,
            createdBy: capa.createdByUser,
          },
          sourceDeviation: capa.deviation,
          investigation: capa.investigation,
          actions: capa.actions,
          effectivenessReviews: capa.effectivenessReviews,
          followUpCycles: capa.followUpCycles,
          notifications: capa.notifications,
          recordCount,
        });
        const manifestHash = createHash('sha256')
          .update(canonicalJson(payload))
          .digest('hex');
        const manifest = {
          ...payload,
          integrity: {
            algorithm: 'SHA-256',
            scope: 'canonical manifest excluding integrity',
            sha256: manifestHash,
          },
        } as Prisma.InputJsonObject;

        await transaction.capaAuditExport.create({
          data: {
            id,
            tenantId: principal.tenantId,
            capaId,
            exportedByUserId: principal.userId,
            schemaVersion,
            fileName,
            recordCount,
            manifest,
            manifestHash,
            generatedAt,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'CAPA_AUDIT_EXPORT_GENERATED',
          outcome: 'SUCCESS',
          request,
          metadata: { capaId, exportId: id, recordCount, manifestHash },
        });

        return {
          id,
          fileName,
          format: 'JSON',
          schemaVersion,
          recordCount,
          manifestHash,
          generatedAt: generatedAt.toISOString(),
          manifest,
        };
      },
    );
  }
}

function normalizeJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function canonicalJson(value: Prisma.InputJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => canonicalJson(item as Prisma.InputJsonValue))
      .join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Prisma.InputJsonObject)[key]!)}`,
    )
    .join(',')}}`;
}

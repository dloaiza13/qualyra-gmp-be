import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../../generated/prisma/client.js';
import type {
  PhotoEvidenceSubjectType,
  TenantPlan,
} from '../../../generated/prisma/client.js';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CapaEvidenceScanner } from '../../capas/domain/ports/capa-evidence-scanner.js';
import { CapaEvidenceStorage } from '../../capas/domain/ports/capa-evidence-storage.js';
import { MetricsService } from '../../observability/application/metrics.service.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  PhotoEvidenceSubjectQueryDto,
  UploadPhotoEvidenceDto,
} from './dto/photo-evidence-request.dto.js';
import type {
  PhotoEvidenceResponseDto,
  PhotoEvidencePageResponseDto,
  PhotoEvidenceUsageResponseDto,
} from './dto/photo-evidence-response.dto.js';

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface UploadedPhotoFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface DownloadedPhotoEvidence {
  bytes: Buffer;
  fileName: string;
  contentType: string;
}

type PhotoRecord = Prisma.PhotoEvidenceGetPayload<{
  include: { uploadedBy: { select: { id: true; displayName: true } } };
}>;

@Injectable()
export class PhotoEvidenceService {
  private readonly maxBytes: number;
  private readonly quotaBytesByPlan: Readonly<Record<TenantPlan, number>>;

  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly storage: CapaEvidenceStorage,
    private readonly scanner: CapaEvidenceScanner,
    private readonly metrics: MetricsService,
    config: ConfigService<Environment, true>,
  ) {
    this.maxBytes = config.getOrThrow('PHOTO_EVIDENCE_MAX_BYTES', {
      infer: true,
    });
    this.quotaBytesByPlan = {
      TRIAL: config.getOrThrow('PHOTO_EVIDENCE_TENANT_QUOTA_BYTES', {
        infer: true,
      }),
      STARTER: config.getOrThrow('PHOTO_EVIDENCE_STARTER_QUOTA_BYTES', {
        infer: true,
      }),
      PROFESSIONAL: config.getOrThrow(
        'PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES',
        { infer: true },
      ),
      ENTERPRISE: config.getOrThrow('PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES', {
        infer: true,
      }),
    };
  }

  async list(
    principal: AuthenticatedPrincipal,
    query: PhotoEvidenceSubjectQueryDto,
  ): Promise<PhotoEvidencePageResponseDto> {
    const records = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await assertSubjectExists(
          transaction,
          principal.tenantId,
          query.subjectType,
          query.subjectId,
        );
        let cursorPosition: { createdAt: Date; id: string } | null = null;
        if (query.cursor) {
          cursorPosition = await transaction.photoEvidence.findFirst({
            where: {
              id: query.cursor,
              tenantId: principal.tenantId,
              subjectType: query.subjectType,
              subjectId: query.subjectId,
            },
            select: { createdAt: true, id: true },
          });
          if (!cursorPosition) {
            throw invalidPhoto('The photographic evidence cursor is invalid.');
          }
        }
        const where: Prisma.PhotoEvidenceWhereInput = {
          tenantId: principal.tenantId,
          subjectType: query.subjectType,
          subjectId: query.subjectId,
          ...(cursorPosition
            ? {
                OR: [
                  { createdAt: { lt: cursorPosition.createdAt } },
                  {
                    createdAt: cursorPosition.createdAt,
                    id: { lt: cursorPosition.id },
                  },
                ],
              }
            : {}),
        };
        return transaction.photoEvidence.findMany({
          where,
          include: {
            uploadedBy: { select: { id: true, displayName: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit + 1,
        });
      },
    );
    const hasMore = records.length > query.limit;
    const page = hasMore ? records.slice(0, query.limit) : records;
    return {
      items: page.map(toResponse),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async usage(
    principal: AuthenticatedPrincipal,
  ): Promise<PhotoEvidenceUsageResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockTenantUsage(transaction, principal.tenantId);
        const plan = await findTenantPlan(transaction, principal.tenantId);
        const usage = await ensureUsageCounter(transaction, principal.tenantId);
        return usageResponse(
          Number(usage.usedBytes),
          usage.photoCount,
          plan,
          this.quotaBytesByPlan[plan],
        );
      },
    );
  }

  async upload(
    principal: AuthenticatedPrincipal,
    input: UploadPhotoEvidenceDto,
    file: UploadedPhotoFile | undefined,
    request: RequestMetadata,
  ): Promise<PhotoEvidenceResponseDto> {
    if (!file || file.buffer.length === 0) {
      throw invalidPhoto('A non-empty image file is required.');
    }
    if (!allowedImageTypes.has(file.mimetype.toLowerCase())) {
      throw invalidPhoto(
        'Only JPEG, PNG, WebP, HEIC, or HEIF images are allowed.',
      );
    }
    if (file.buffer.length > this.maxBytes) {
      throw invalidPhoto(`The image exceeds the ${this.maxBytes} byte limit.`);
    }

    const fileName = safeFileName(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = [
      principal.tenantId,
      'photo-evidence',
      input.subjectType.toLowerCase(),
      input.subjectId,
      randomUUID(),
    ].join('/');
    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : null;
    if (capturedAt && capturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw invalidPhoto('The capture date cannot be in the future.');
    }

    let scan;
    try {
      scan = await this.scanner.scan({
        fileName,
        contentType: file.mimetype,
        bytes: file.buffer,
      });
    } catch (error: unknown) {
      this.metrics.recordPhotoEvidenceUpload('rejected');
      const message =
        error instanceof Error ? error.message : 'The image was rejected.';
      if (/unavailable|timed out|returned no result/i.test(message)) {
        throw new ApplicationError(
          ErrorCode.InternalError,
          message,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw invalidPhoto(message);
    }

    let stored;
    try {
      stored = await this.storage.store(
        objectKey,
        file.buffer,
        file.mimetype,
        sha256,
      );
    } catch {
      this.metrics.recordPhotoEvidenceUpload('storage_error');
      throw new ApplicationError(
        ErrorCode.InternalError,
        'Managed photo storage is unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const record = await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          await lockTenantUsage(transaction, principal.tenantId);
          await assertSubjectExists(
            transaction,
            principal.tenantId,
            input.subjectType,
            input.subjectId,
          );
          const duplicate = await transaction.photoEvidence.findFirst({
            where: {
              tenantId: principal.tenantId,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              sha256,
            },
            select: { id: true },
          });
          if (duplicate) {
            throw new ApplicationError(
              ErrorCode.PhotoEvidenceConflict,
              'This image is already attached to the record.',
              HttpStatus.CONFLICT,
            );
          }
          const plan = await findTenantPlan(transaction, principal.tenantId);
          const usage = await ensureUsageCounter(
            transaction,
            principal.tenantId,
          );
          const usedBytes = Number(usage.usedBytes);
          if (usedBytes + file.buffer.length > this.quotaBytesByPlan[plan]) {
            throw new ApplicationError(
              ErrorCode.PhotoEvidenceQuotaExceeded,
              'The organization has reached its photographic evidence storage quota.',
              HttpStatus.INSUFFICIENT_STORAGE,
            );
          }
          const created = await transaction.photoEvidence.create({
            data: {
              tenantId: principal.tenantId,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              fileName,
              contentType: file.mimetype.toLowerCase(),
              sizeBytes: file.buffer.length,
              sha256,
              objectKey: stored.objectKey,
              storageDriver: stored.storageDriver,
              caption: input.caption?.trim() || null,
              capturedAt,
              scanEngine: scan.engine,
              scanResult: scan.result,
              scannedAt: new Date(),
              uploadedByUserId: principal.userId,
            },
            include: {
              uploadedBy: { select: { id: true, displayName: true } },
            },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: principal.userId,
            eventType: 'PHOTO_EVIDENCE_UPLOADED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              photoEvidenceId: created.id,
              subjectType: created.subjectType,
              subjectId: created.subjectId,
              sha256: created.sha256,
              sizeBytes: created.sizeBytes,
              storageDriver: created.storageDriver,
              scanEngine: created.scanEngine,
            },
          });
          return created;
        },
      );
      this.metrics.recordPhotoEvidenceUpload('success', file.buffer.length);
      return toResponse(record);
    } catch (error) {
      await this.storage.remove(stored.objectKey).catch(() => undefined);
      this.metrics.recordPhotoEvidenceUpload(
        error instanceof ApplicationError &&
          error.code === ErrorCode.PhotoEvidenceQuotaExceeded
          ? 'quota_exceeded'
          : 'rejected',
      );
      throw error;
    }
  }

  async download(
    principal: AuthenticatedPrincipal,
    evidenceId: string,
  ): Promise<DownloadedPhotoEvidence> {
    const evidence = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.photoEvidence.findFirst({
          where: { id: evidenceId, tenantId: principal.tenantId },
        }),
    );
    if (!evidence) {
      throw new ApplicationError(
        ErrorCode.PhotoEvidenceNotFound,
        'The photographic evidence was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    try {
      const bytes = await this.storage.read(evidence.objectKey);
      const actualSha256 = createHash('sha256').update(bytes).digest('hex');
      if (actualSha256 !== evidence.sha256) {
        throw new Error('Photo evidence integrity verification failed.');
      }
      return {
        bytes,
        fileName: evidence.fileName,
        contentType: evidence.contentType,
      };
    } catch {
      throw new ApplicationError(
        ErrorCode.InternalError,
        'The photographic evidence failed integrity verification.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

async function assertSubjectExists(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  subjectType: PhotoEvidenceSubjectType,
  subjectId: string,
): Promise<void> {
  const where = { id: subjectId, tenantId };
  let found: { id: string } | null;
  switch (subjectType) {
    case 'DOCUMENT':
      found = await transaction.document.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'TRAINING_ASSIGNMENT':
      found = await transaction.trainingAssignment.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'DEVIATION':
      found = await transaction.deviation.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'CAPA':
      found = await transaction.capa.findFirst({ where, select: { id: true } });
      break;
    case 'CHANGE_CONTROL':
      found = await transaction.changeControl.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'AUDIT':
      found = await transaction.gmpAudit.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'QUALITY_RISK':
      found = await transaction.qualityRiskAssessment.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'SUPPLIER':
      found = await transaction.supplier.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'EQUIPMENT':
      found = await transaction.equipment.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'COMPLAINT':
      found = await transaction.productComplaint.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'RECALL':
      found = await transaction.productRecall.findFirst({
        where,
        select: { id: true },
      });
      break;
    case 'PRODUCT_REVIEW':
      found = await transaction.productQualityReview.findFirst({
        where,
        select: { id: true },
      });
      break;
  }
  if (!found) {
    throw new ApplicationError(
      ErrorCode.PhotoEvidenceNotFound,
      'The record selected for photographic evidence was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}

function toResponse(record: PhotoRecord): PhotoEvidenceResponseDto {
  return {
    id: record.id,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    caption: record.caption,
    capturedAt: record.capturedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    uploadedBy: record.uploadedBy,
    contentUrl: `/photo-evidence/${record.id}/content`,
  };
}

function usageResponse(
  usedBytes: number,
  photoCount: number,
  plan: TenantPlan,
  quotaBytes: number,
): PhotoEvidenceUsageResponseDto {
  return {
    plan,
    usedBytes,
    quotaBytes,
    remainingBytes: Math.max(0, quotaBytes - usedBytes),
    photoCount,
    usagePercent: Number(((usedBytes / quotaBytes) * 100).toFixed(2)),
  };
}

async function lockTenantUsage(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:photo-evidence`}, 0)
    )
  `;
}

async function findTenantPlan(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<TenantPlan> {
  const tenant = await transaction.tenant.findFirst({
    where: { id: tenantId },
    select: { plan: true },
  });
  if (!tenant) {
    throw new ApplicationError(
      ErrorCode.PhotoEvidenceNotFound,
      'The organization was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
  return tenant.plan;
}

async function ensureUsageCounter(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<{ usedBytes: bigint; photoCount: number }> {
  const existing = await transaction.tenantPhotoEvidenceUsage.findUnique({
    where: { tenantId },
    select: { usedBytes: true, photoCount: true },
  });
  if (existing) return existing;

  const aggregate = await transaction.photoEvidence.aggregate({
    where: { tenantId },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  return transaction.tenantPhotoEvidenceUsage.create({
    data: {
      tenantId,
      usedBytes: BigInt(aggregate._sum.sizeBytes ?? 0),
      photoCount: aggregate._count._all,
    },
    select: { usedBytes: true, photoCount: true },
  });
}

function safeFileName(value: string): string {
  const fileName = basename(value.replaceAll('\\', '/'))
    .normalize('NFC')
    .trim();
  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    fileName.length > 255
  ) {
    throw invalidPhoto('The image filename is invalid.');
  }
  return fileName;
}

function invalidPhoto(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.PhotoEvidenceInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

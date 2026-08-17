import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { CapaEvidenceScanner } from '../domain/ports/capa-evidence-scanner.js';
import { CapaEvidenceStorage } from '../domain/ports/capa-evidence-storage.js';
import type { CapaEvidenceUploadResponseDto } from './dto/capa-response.dto.js';

export interface UploadedEvidenceFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface DownloadedEvidence {
  bytes: Buffer;
  fileName: string;
  contentType: string;
}

@Injectable()
export class CapaEvidenceService {
  private readonly uploadTtlHours: number;

  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly storage: CapaEvidenceStorage,
    private readonly scanner: CapaEvidenceScanner,
    config: ConfigService<Environment, true>,
  ) {
    this.uploadTtlHours = config.getOrThrow('CAPA_EVIDENCE_UPLOAD_TTL_HOURS', {
      infer: true,
    });
  }

  async upload(
    principal: AuthenticatedPrincipal,
    capaId: string,
    actionId: string,
    file: UploadedEvidenceFile | undefined,
    request: RequestMetadata,
  ): Promise<CapaEvidenceUploadResponseDto> {
    if (!file) throw invalidEvidence('An evidence file is required.');

    const allowed = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.capaAction.findFirst({
          where: {
            id: actionId,
            capaId,
            tenantId: principal.tenantId,
            assignedToUserId: principal.userId,
            status: 'OPEN',
          },
          select: { id: true },
        }),
    );
    if (!allowed) {
      throw new ApplicationError(
        ErrorCode.CapaActionForbidden,
        'Only the assigned user can upload evidence to an open CAPA action.',
        HttpStatus.FORBIDDEN,
      );
    }

    const fileName = safeFileName(file.originalname);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const objectKey = [principal.tenantId, capaId, actionId, randomUUID()].join(
      '/',
    );
    let scan;
    try {
      scan = await this.scanner.scan({
        fileName,
        contentType: file.mimetype,
        bytes: file.buffer,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'The evidence file was rejected.';
      if (/unavailable|timed out|returned no result/i.test(message)) {
        throw new ApplicationError(
          ErrorCode.InternalError,
          message,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw invalidEvidence(message);
    }

    try {
      await this.storage.store(objectKey, file.buffer, file.mimetype, sha256);
    } catch {
      throw new ApplicationError(
        ErrorCode.InternalError,
        'Managed evidence storage is unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.uploadTtlHours * 60 * 60 * 1000,
    );
    try {
      return await this.tenantUnitOfWork.execute(
        principal.tenantId,
        async (transaction) => {
          const upload = await transaction.capaEvidenceUpload.create({
            data: {
              tenantId: principal.tenantId,
              capaId,
              actionId,
              uploadedByUserId: principal.userId,
              fileName,
              contentType: file.mimetype,
              sizeBytes: file.buffer.length,
              sha256,
              objectKey,
              scanStatus: 'AVAILABLE',
              scanEngine: scan.engine,
              scanResult: scan.result,
              scannedAt: now,
              expiresAt,
            },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: principal.userId,
            eventType: 'CAPA_EVIDENCE_UPLOADED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              capaId,
              actionId,
              evidenceUploadId: upload.id,
              sha256: upload.sha256,
              sizeBytes: upload.sizeBytes,
              scanEngine: upload.scanEngine,
              scanResult: upload.scanResult,
            },
          });
          return {
            id: upload.id,
            fileName: upload.fileName,
            contentType: upload.contentType,
            sizeBytes: upload.sizeBytes,
            sha256: upload.sha256,
            scanStatus: upload.scanStatus,
            scanEngine: upload.scanEngine,
            scanResult: upload.scanResult,
            expiresAt: upload.expiresAt.toISOString(),
          };
        },
      );
    } catch (error) {
      await this.storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async download(
    principal: AuthenticatedPrincipal,
    capaId: string,
    evidenceId: string,
  ): Promise<DownloadedEvidence> {
    const evidence = await this.tenantUnitOfWork.execute(
      principal.tenantId,
      (transaction) =>
        transaction.capaActionEvidenceReference.findFirst({
          where: { id: evidenceId, capaId, tenantId: principal.tenantId },
          include: { evidenceUpload: true },
        }),
    );
    if (
      !evidence?.evidenceUpload ||
      evidence.evidenceUpload.scanStatus !== 'AVAILABLE'
    ) {
      throw new ApplicationError(
        ErrorCode.CapaNotFound,
        'The managed CAPA evidence file was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    try {
      return {
        bytes: await this.readAndVerify(
          evidence.evidenceUpload.objectKey,
          evidence.sha256,
        ),
        fileName: evidence.fileName,
        contentType: evidence.contentType,
      };
    } catch {
      throw new ApplicationError(
        ErrorCode.InternalError,
        'The managed evidence failed integrity verification.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async readAndVerify(
    objectKey: string,
    expectedSha256: string,
  ): Promise<Buffer> {
    const bytes = await this.storage.read(objectKey);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== expectedSha256) {
      throw new Error('Managed evidence integrity verification failed.');
    }
    return bytes;
  }
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
    throw invalidEvidence('The evidence filename is invalid.');
  }
  return fileName;
}

function invalidEvidence(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.CapaInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

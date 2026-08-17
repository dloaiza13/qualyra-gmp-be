import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CancelTrainingAssignmentDto,
  CompleteTrainingAssignmentDto,
  CreateTrainingAssignmentsDto,
  TrainingAssignmentListQueryDto,
} from './dto/training-request.dto.js';
import type {
  TrainingAssignmentDetailResponseDto,
  TrainingAssignmentSummaryResponseDto,
  TrainingUserSummaryDto,
} from './dto/training-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const assignmentSummaryInclude = {
  assignedToUser: { select: userSummary },
  assignedByUser: { select: userSummary },
  cancelledByUser: { select: userSummary },
  document: { select: { id: true, code: true, type: true, status: true } },
  documentVersion: {
    select: {
      id: true,
      versionNumber: true,
      title: true,
      description: true,
      status: true,
    },
  },
} satisfies Prisma.TrainingAssignmentInclude;
const assignmentDetailInclude = {
  ...assignmentSummaryInclude,
  documentVersion: {
    select: {
      id: true,
      versionNumber: true,
      title: true,
      description: true,
      content: true,
      status: true,
      release: { select: { recordHash: true } },
    },
  },
} satisfies Prisma.TrainingAssignmentInclude;

type TrainingAssignmentSummaryRecord = Prisma.TrainingAssignmentGetPayload<{
  include: typeof assignmentSummaryInclude;
}>;
type TrainingAssignmentDetailRecord = Prisma.TrainingAssignmentGetPayload<{
  include: typeof assignmentDetailInclude;
}>;

@Injectable()
export class TrainingService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  listMine(
    principal: AuthenticatedPrincipal,
    query: TrainingAssignmentListQueryDto,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.list(principal, query, principal.userId);
  }

  listAll(
    principal: AuthenticatedPrincipal,
    query: TrainingAssignmentListQueryDto,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.list(principal, query);
  }

  private list(
    principal: AuthenticatedPrincipal,
    query: TrainingAssignmentListQueryDto,
    assignedToUserId?: string,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const assignments = await transaction.trainingAssignment.findMany({
          where: {
            tenantId: principal.tenantId,
            assignedToUserId,
            status: query.status,
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
          include: assignmentSummaryInclude,
        });
        return assignments.map((assignment) => mapSummary(assignment, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    assignmentId: string,
  ): Promise<TrainingAssignmentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const assignment = await readAssignment(
          transaction,
          principal.tenantId,
          assignmentId,
        );
        if (
          assignment.assignedToUserId !== principal.userId &&
          !(await hasPermission(
            transaction,
            principal.tenantId,
            principal.userId,
            'training.assign',
          ))
        ) {
          throw trainingForbidden();
        }
        return mapDetail(assignment);
      },
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateTrainingAssignmentsDto,
    request: RequestMetadata,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const dueAt = new Date(input.dueAt);
        if (dueAt.getTime() <= now.getTime()) {
          throw trainingInvalid('The training due date must be in the future.');
        }

        const document = await transaction.document.findFirst({
          where: {
            id: input.documentId,
            tenantId: principal.tenantId,
            status: 'EFFECTIVE',
          },
          select: { id: true, code: true },
        });
        if (!document) {
          throw trainingInvalid('Only an effective document can be assigned.');
        }
        const version = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId: document.id,
            status: 'EFFECTIVE',
          },
          select: { id: true, versionNumber: true },
        });
        if (!version) {
          throw trainingInvalid('The document has no effective version.');
        }

        const assignees = await transaction.user.findMany({
          where: {
            id: { in: input.assigneeUserIds },
            tenantId: principal.tenantId,
            status: 'ACTIVE',
            userRoles: {
              some: {
                role: {
                  rolePermissions: {
                    some: { permission: { code: 'training.complete' } },
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        if (assignees.length !== input.assigneeUserIds.length) {
          throw trainingInvalid(
            'Every assignee must be active and have training completion permission.',
          );
        }

        const duplicate = await transaction.trainingAssignment.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentVersionId: version.id,
            assignedToUserId: { in: input.assigneeUserIds },
            status: 'ASSIGNED',
          },
          select: { id: true },
        });
        if (duplicate) throw trainingConflict();

        const assignmentIds: string[] = [];
        try {
          for (const assigneeUserId of input.assigneeUserIds) {
            const assignment = await transaction.trainingAssignment.create({
              data: {
                tenantId: principal.tenantId,
                documentId: document.id,
                documentVersionId: version.id,
                assignedToUserId: assigneeUserId,
                assignedByUserId: principal.userId,
                dueAt,
                reason: input.reason,
              },
              select: { id: true },
            });
            assignmentIds.push(assignment.id);
          }
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw trainingConflict();
          throw error;
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'TRAINING_ASSIGNMENTS_CREATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId: document.id,
            documentVersionId: version.id,
            documentCode: document.code,
            versionNumber: version.versionNumber,
            assignmentIds,
            assigneeUserIds: input.assigneeUserIds,
            dueAt: dueAt.toISOString(),
          },
        });

        const assignments = await transaction.trainingAssignment.findMany({
          where: { tenantId: principal.tenantId, id: { in: assignmentIds } },
          orderBy: { createdAt: 'asc' },
          include: assignmentSummaryInclude,
        });
        return assignments.map((assignment) => mapSummary(assignment, now));
      },
    );
  }

  async complete(
    principal: AuthenticatedPrincipal,
    assignmentId: string,
    input: CompleteTrainingAssignmentDto,
    request: RequestMetadata,
  ): Promise<TrainingAssignmentDetailResponseDto> {
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
          eventType: 'TRAINING_REAUTHENTICATION_FAILED',
          outcome: 'FAILURE',
          request,
          metadata: { assignmentId },
        }),
      );
      throw reauthenticationFailed();
    }

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const assignment = await readAssignment(
          transaction,
          principal.tenantId,
          assignmentId,
        );
        if (assignment.assignedToUserId !== principal.userId) {
          throw trainingForbidden();
        }
        if (
          assignment.status !== 'ASSIGNED' ||
          assignment.document.status !== 'EFFECTIVE' ||
          assignment.documentVersion.status !== 'EFFECTIVE' ||
          !assignment.documentVersion.release
        ) {
          throw trainingConflict();
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

        const recordHash = hashRecord({
          schemaVersion: 1,
          assignmentId: assignment.id,
          documentId: assignment.document.id,
          documentCode: assignment.document.code,
          documentVersionId: assignment.documentVersion.id,
          versionNumber: assignment.documentVersion.versionNumber,
          title: assignment.documentVersion.title,
          contentHash: hashRecord({
            content: assignment.documentVersion.content,
          }),
          releaseRecordHash: assignment.documentVersion.release.recordHash,
          assignedToUserId: assignment.assignedToUserId,
          assignedByUserId: assignment.assignedByUserId,
          assignedAt: assignment.createdAt.toISOString(),
          dueAt: assignment.dueAt.toISOString(),
          assignmentReason: assignment.reason,
          completedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'TRAINING_ACKNOWLEDGEMENT',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          completionComment: input.comment,
          completedAt: now.toISOString(),
        });

        const completed = await transaction.trainingAssignment.updateMany({
          where: {
            id: assignment.id,
            tenantId: principal.tenantId,
            status: 'ASSIGNED',
          },
          data: {
            status: 'COMPLETED',
            meaning: 'TRAINING_ACKNOWLEDGEMENT',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            completionSessionId: principal.sessionId,
            completionComment: input.comment,
            completedAt: now,
            recordHash,
          },
        });
        if (completed.count !== 1) throw trainingConflict();

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: principal.userId,
          eventType: 'TRAINING_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            assignmentId: assignment.id,
            documentId: assignment.document.id,
            documentVersionId: assignment.documentVersion.id,
            versionNumber: assignment.documentVersion.versionNumber,
            meaning: 'TRAINING_ACKNOWLEDGEMENT',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
          },
        });
        return mapDetail(
          await readAssignment(transaction, principal.tenantId, assignment.id),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    assignmentId: string,
    input: CancelTrainingAssignmentDto,
    request: RequestMetadata,
  ): Promise<TrainingAssignmentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const assignment = await transaction.trainingAssignment.findFirst({
          where: { id: assignmentId, tenantId: principal.tenantId },
          select: { id: true, status: true, assignedToUserId: true },
        });
        if (!assignment) throw trainingNotFound();
        if (assignment.status !== 'ASSIGNED') throw trainingConflict();
        const now = new Date();
        const cancelled = await transaction.trainingAssignment.updateMany({
          where: {
            id: assignment.id,
            tenantId: principal.tenantId,
            status: 'ASSIGNED',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancelledAt: now,
            cancellationReason: input.reason,
          },
        });
        if (cancelled.count !== 1) throw trainingConflict();

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: assignment.assignedToUserId,
          eventType: 'TRAINING_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: { assignmentId: assignment.id, reason: input.reason },
        });
        return mapDetail(
          await readAssignment(transaction, principal.tenantId, assignment.id),
        );
      },
    );
  }
}

function mapSummary(
  assignment: TrainingAssignmentSummaryRecord,
  now = new Date(),
): TrainingAssignmentSummaryResponseDto {
  return {
    id: assignment.id,
    status: assignment.status,
    dueState: dueState(assignment.status, assignment.dueAt, now),
    dueAt: assignment.dueAt.toISOString(),
    reason: assignment.reason,
    assignedTo: mapUser(assignment.assignedToUser),
    assignedBy: mapUser(assignment.assignedByUser),
    document: assignment.document,
    documentVersion: assignment.documentVersion,
    meaning: assignment.meaning,
    authenticationMethod: assignment.authenticationMethod,
    completionComment: assignment.completionComment,
    completedAt: assignment.completedAt?.toISOString() ?? null,
    cancelledBy: assignment.cancelledByUser
      ? mapUser(assignment.cancelledByUser)
      : null,
    cancelledAt: assignment.cancelledAt?.toISOString() ?? null,
    cancellationReason: assignment.cancellationReason,
    createdAt: assignment.createdAt.toISOString(),
  };
}

function mapDetail(
  assignment: TrainingAssignmentDetailRecord,
): TrainingAssignmentDetailResponseDto {
  return {
    ...mapSummary(assignment),
    content: assignment.documentVersion.content,
    recordHash: assignment.recordHash,
  };
}

function mapUser(user: TrainingUserSummaryDto): TrainingUserSummaryDto {
  return user;
}

function dueState(
  status: 'ASSIGNED' | 'COMPLETED' | 'CANCELLED',
  dueAt: Date,
  now: Date,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED' {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  const dueSoonThreshold = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  return dueAt.getTime() <= dueSoonThreshold ? 'DUE_SOON' : 'ON_TRACK';
}

async function readAssignment(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  assignmentId: string,
): Promise<TrainingAssignmentDetailRecord> {
  const assignment = await transaction.trainingAssignment.findFirst({
    where: { id: assignmentId, tenantId },
    include: assignmentDetailInclude,
  });
  if (!assignment) throw trainingNotFound();
  return assignment;
}

async function hasPermission(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  permission: string,
): Promise<boolean> {
  return Boolean(
    await transaction.user.findFirst({
      where: {
        id: userId,
        tenantId,
        status: 'ACTIVE',
        userRoles: {
          some: {
            role: {
              rolePermissions: { some: { permission: { code: permission } } },
            },
          },
        },
      },
      select: { id: true },
    }),
  );
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function trainingNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.TrainingNotFound,
    'The training assignment was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function trainingInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.TrainingInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function trainingConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.TrainingConflict,
    'The training assignment changed. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function trainingForbidden(): ApplicationError {
  return new ApplicationError(
    ErrorCode.TrainingForbidden,
    'The training assignment is not available to this user.',
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

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002',
  );
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { documentAccessWhere } from '../../authorization/application/record-access.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  ConfigurePeriodicReviewDto,
  CreateDocumentDto,
  CreateDocumentVersionDto,
  DocumentDecisionDto,
  DocumentListQueryDto,
  ObsoleteDocumentDto,
  PeriodicReviewDecisionDto,
  ReleaseDocumentDto,
  RequestDocumentReviewDto,
} from './dto/document-request.dto.js';
import type {
  DocumentDetailResponseDto,
  DocumentObsolescenceResponseDto,
  DocumentPeriodicReviewResponseDto,
  DocumentReleaseResponseDto,
  DocumentSummaryResponseDto,
  DocumentUserSummaryDto,
  DocumentVersionResponseDto,
  DocumentVersionSummaryDto,
  DocumentWorkflowResponseDto,
} from './dto/document-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const versionDetails = {
  createdByUser: { select: userSummary },
} satisfies Prisma.DocumentVersionInclude;
const periodicReviewDetails = {
  documentVersion: { select: { id: true, versionNumber: true } },
  assignedToUser: { select: userSummary },
  scheduledByUser: { select: userSummary },
} satisfies Prisma.DocumentPeriodicReviewInclude;
const documentSummaryDetails = {
  ownerUser: { select: userSummary },
  createdByUser: { select: userSummary },
  periodicReviewReviewer: { select: userSummary },
  versions: {
    orderBy: { versionNumber: 'desc' as const },
    take: 1,
    include: versionDetails,
  },
  periodicReviews: {
    where: { status: 'PENDING' as const },
    orderBy: { dueAt: 'asc' as const },
    take: 1,
    include: periodicReviewDetails,
  },
} satisfies Prisma.DocumentInclude;
const documentDetails = {
  ownerUser: { select: userSummary },
  createdByUser: { select: userSummary },
  periodicReviewReviewer: { select: userSummary },
  versions: {
    orderBy: { versionNumber: 'desc' as const },
    include: versionDetails,
  },
  workflows: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      documentVersion: { select: { id: true, versionNumber: true } },
      requestedByUser: { select: userSummary },
      reviewerUser: { select: userSummary },
      approverUser: { select: userSummary },
    },
  },
  releases: {
    orderBy: { releasedAt: 'desc' as const },
    include: {
      documentVersion: { select: { id: true, versionNumber: true } },
      releasedByUser: { select: userSummary },
    },
  },
  obsolescences: {
    orderBy: { obsoletedAt: 'desc' as const },
    include: {
      documentVersion: { select: { id: true, versionNumber: true } },
      obsoletedByUser: { select: userSummary },
    },
  },
  periodicReviews: {
    orderBy: { createdAt: 'desc' as const },
    include: periodicReviewDetails,
  },
} satisfies Prisma.DocumentInclude;

type DocumentSummaryRecord = Prisma.DocumentGetPayload<{
  include: typeof documentSummaryDetails;
}>;
type DocumentDetailRecord = Prisma.DocumentGetPayload<{
  include: typeof documentDetails;
}>;
type DocumentVersionRecord = DocumentDetailRecord['versions'][number];
type DocumentWorkflowRecord = DocumentDetailRecord['workflows'][number];
type DocumentReleaseRecord = DocumentDetailRecord['releases'][number];
type DocumentObsolescenceRecord = DocumentDetailRecord['obsolescences'][number];
type DocumentPeriodicReviewRecord =
  DocumentDetailRecord['periodicReviews'][number];

@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  list(
    principal: AuthenticatedPrincipal,
    query: DocumentListQueryDto,
  ): Promise<DocumentSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const documents = await transaction.document.findMany({
          where: {
            tenantId: principal.tenantId,
            AND: [documentAccessWhere(principal)],
            type: query.type,
            status: query.status,
            ...(query.search
              ? {
                  OR: [
                    {
                      code: {
                        contains: query.search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      versions: {
                        some: {
                          title: {
                            contains: query.search,
                            mode: 'insensitive' as const,
                          },
                        },
                      },
                    },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ updatedAt: 'desc' }, { code: 'asc' }],
          include: documentSummaryDetails,
        });
        return documents.map((document) => mapDocumentSummary(document));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    documentId: string,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const document = await transaction.document.findFirst({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            AND: [documentAccessWhere(principal)],
          },
          include: documentDetails,
        });
        if (!document) throw documentNotFound();
        return mapDocumentDetail(document);
      },
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateDocumentDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const ownerUserId = input.ownerUserId ?? principal.userId;
        const owner = await transaction.user.findFirst({
          where: {
            id: ownerUserId,
            tenantId: principal.tenantId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!owner) throw documentInvalid('The document owner is invalid.');

        try {
          const document = await transaction.document.create({
            data: {
              tenantId: principal.tenantId,
              code: input.code,
              type: input.type,
              ownerUserId,
              createdByUserId: principal.userId,
              versions: {
                create: {
                  versionNumber: 1,
                  title: input.title,
                  description: input.description,
                  content: input.content,
                  changeSummary: input.changeSummary,
                  createdByUserId: principal.userId,
                },
              },
            },
            include: documentDetails,
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'DOCUMENT_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              documentId: document.id,
              code: document.code,
              versionNumber: 1,
            },
          });
          return mapDocumentDetail(document);
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw documentCodeExists();
          throw error;
        }
      },
    );
  }

  createVersion(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: CreateDocumentVersionDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const existing = await transaction.document.findFirst({
          where: { id: documentId, tenantId: principal.tenantId },
          select: { id: true, status: true, currentVersionNumber: true },
        });
        if (!existing) throw documentNotFound();
        if (existing.status !== 'DRAFT' && existing.status !== 'EFFECTIVE') {
          throw documentVersionConflict();
        }

        const currentVersion = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            versionNumber: existing.currentVersionNumber,
          },
          select: { id: true, status: true },
        });
        if (
          !currentVersion ||
          (currentVersion.status !== 'DRAFT' &&
            currentVersion.status !== 'EFFECTIVE')
        ) {
          throw documentVersionConflict();
        }
        if (
          currentVersion.status === 'EFFECTIVE' &&
          existing.status !== 'EFFECTIVE'
        ) {
          throw documentVersionConflict();
        }

        const effectiveVersion =
          existing.status === 'EFFECTIVE'
            ? await transaction.documentVersion.findFirst({
                where: {
                  tenantId: principal.tenantId,
                  documentId,
                  status: 'EFFECTIVE',
                },
                select: { id: true, versionNumber: true },
              })
            : null;
        if (existing.status === 'EFFECTIVE' && !effectiveVersion) {
          throw documentVersionConflict();
        }

        const claimed = await transaction.document.updateMany({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            status: existing.status,
            currentVersionNumber: existing.currentVersionNumber,
          },
          data: { currentVersionNumber: { increment: 1 } },
        });
        if (claimed.count !== 1) throw documentVersionConflict();

        if (currentVersion.status === 'DRAFT') {
          const previous = await transaction.documentVersion.updateMany({
            where: {
              id: currentVersion.id,
              tenantId: principal.tenantId,
              status: 'DRAFT',
            },
            data: { status: 'SUPERSEDED' },
          });
          if (previous.count !== 1) throw documentVersionConflict();
        }

        const nextVersionNumber = existing.currentVersionNumber + 1;
        await transaction.documentVersion.create({
          data: {
            tenantId: principal.tenantId,
            documentId,
            versionNumber: nextVersionNumber,
            title: input.title,
            description: input.description,
            content: input.content,
            changeSummary: input.changeSummary,
            createdByUserId: principal.userId,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: effectiveVersion
            ? 'DOCUMENT_REVISION_STARTED'
            : 'DOCUMENT_VERSION_CREATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            versionNumber: nextVersionNumber,
            effectiveVersionNumber: effectiveVersion?.versionNumber,
          },
        });

        const document = await transaction.document.findUniqueOrThrow({
          where: { id: documentId },
          include: documentDetails,
        });
        return mapDocumentDetail(document);
      },
    );
  }

  configurePeriodicReview(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: ConfigurePeriodicReviewDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const document = await transaction.document.findFirst({
          where: { id: documentId, tenantId: principal.tenantId },
          select: { id: true, status: true, currentVersionNumber: true },
        });
        if (!document) throw documentNotFound();
        if (document.status !== 'EFFECTIVE') {
          throw documentPeriodicReviewConflict();
        }

        const version = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            status: 'EFFECTIVE',
          },
          select: { id: true, versionNumber: true, createdByUserId: true },
        });
        if (!version) {
          throw documentPeriodicReviewConflict(
            'Resolve the active revision before scheduling a periodic review.',
          );
        }
        if (input.reviewerUserId === version.createdByUserId) {
          throw documentPeriodicReviewInvalid(
            'The effective version author cannot perform its periodic review.',
          );
        }
        await requireQualifiedAssignee(
          transaction,
          principal.tenantId,
          input.reviewerUserId,
          'documents.review',
          'The selected periodic reviewer is not active or lacks review permission.',
          documentPeriodicReviewInvalid,
        );

        const pending = await transaction.documentPeriodicReview.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            status: 'PENDING',
          },
          select: { id: true },
        });
        if (pending) {
          const cancelled = await transaction.documentPeriodicReview.updateMany(
            {
              where: {
                id: pending.id,
                tenantId: principal.tenantId,
                status: 'PENDING',
              },
              data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancellationReason: 'SCHEDULE_REPLACED',
              },
            },
          );
          if (cancelled.count !== 1) throw documentPeriodicReviewConflict();
        }

        const configured = await transaction.document.updateMany({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            status: 'EFFECTIVE',
            currentVersionNumber: document.currentVersionNumber,
          },
          data: {
            periodicReviewIntervalMonths: input.intervalMonths,
            periodicReviewReviewerUserId: input.reviewerUserId,
          },
        });
        if (configured.count !== 1) throw documentPeriodicReviewConflict();

        const dueAt = addUtcMonths(now, input.intervalMonths);
        let periodicReviewId: string;
        try {
          const review = await transaction.documentPeriodicReview.create({
            data: {
              tenantId: principal.tenantId,
              documentId,
              documentVersionId: version.id,
              assignedToUserId: input.reviewerUserId,
              scheduledByUserId: principal.userId,
              intervalMonths: input.intervalMonths,
              dueAt,
            },
            select: { id: true },
          });
          periodicReviewId = review.id;
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) {
            throw documentPeriodicReviewConflict();
          }
          throw error;
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.reviewerUserId,
          eventType: 'DOCUMENT_PERIODIC_REVIEW_SCHEDULED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: version.id,
            versionNumber: version.versionNumber,
            periodicReviewId,
            intervalMonths: input.intervalMonths,
            dueAt: dueAt.toISOString(),
            replacedPeriodicReviewId: pending?.id,
          },
        });
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }

  periodicReviewDecision(
    principal: AuthenticatedPrincipal,
    documentId: string,
    periodicReviewId: string,
    input: PeriodicReviewDecisionDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const document = await transaction.document.findFirst({
          where: { id: documentId, tenantId: principal.tenantId },
          select: {
            id: true,
            status: true,
            currentVersionNumber: true,
            periodicReviewIntervalMonths: true,
            periodicReviewReviewerUserId: true,
          },
        });
        if (!document) throw documentNotFound();
        if (document.status !== 'EFFECTIVE') {
          throw documentPeriodicReviewConflict();
        }

        const review = await transaction.documentPeriodicReview.findFirst({
          where: {
            id: periodicReviewId,
            tenantId: principal.tenantId,
            documentId,
            status: 'PENDING',
          },
          select: {
            id: true,
            documentVersionId: true,
            assignedToUserId: true,
            intervalMonths: true,
          },
        });
        if (!review) throw documentPeriodicReviewConflict();
        if (review.assignedToUserId !== principal.userId) {
          throw documentDecisionForbidden(
            'Only the assigned periodic reviewer can record this decision.',
          );
        }

        const version = await transaction.documentVersion.findFirst({
          where: {
            id: review.documentVersionId,
            tenantId: principal.tenantId,
            documentId,
            status: 'EFFECTIVE',
          },
          select: { id: true, versionNumber: true },
        });
        if (!version) throw documentPeriodicReviewConflict();

        const completed = await transaction.documentPeriodicReview.updateMany({
          where: {
            id: review.id,
            tenantId: principal.tenantId,
            status: 'PENDING',
          },
          data: {
            status: 'COMPLETED',
            decision: input.decision,
            comment: input.comment,
            completedAt: now,
          },
        });
        if (completed.count !== 1) throw documentPeriodicReviewConflict();

        let nextPeriodicReviewId: string | undefined;
        let nextDueAt: Date | undefined;
        if (input.decision === 'CONFIRM_EFFECTIVE') {
          if (
            document.periodicReviewIntervalMonths !== review.intervalMonths ||
            document.periodicReviewReviewerUserId !== principal.userId
          ) {
            throw documentPeriodicReviewConflict();
          }
          nextDueAt = addUtcMonths(now, review.intervalMonths);
          try {
            const next = await transaction.documentPeriodicReview.create({
              data: {
                tenantId: principal.tenantId,
                documentId,
                documentVersionId: version.id,
                assignedToUserId: principal.userId,
                scheduledByUserId: principal.userId,
                intervalMonths: review.intervalMonths,
                dueAt: nextDueAt,
              },
              select: { id: true },
            });
            nextPeriodicReviewId = next.id;
          } catch (error: unknown) {
            if (isUniqueConstraintError(error)) {
              throw documentPeriodicReviewConflict();
            }
            throw error;
          }
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType:
            input.decision === 'CONFIRM_EFFECTIVE'
              ? 'DOCUMENT_PERIODIC_REVIEW_CONFIRMED'
              : 'DOCUMENT_REVISION_REQUIRED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: version.id,
            versionNumber: version.versionNumber,
            periodicReviewId: review.id,
            decision: input.decision,
            nextPeriodicReviewId,
            nextDueAt: nextDueAt?.toISOString(),
          },
        });
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }

  requestReview(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: RequestDocumentReviewDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const document = await transaction.document.findFirst({
          where: { id: documentId, tenantId: principal.tenantId },
          select: { id: true, status: true, currentVersionNumber: true },
        });
        if (!document) throw documentNotFound();
        if (document.status !== 'DRAFT' && document.status !== 'EFFECTIVE') {
          throw documentWorkflowConflict();
        }
        if (input.reviewerUserId === input.approverUserId) {
          throw documentWorkflowInvalid(
            'The reviewer and approver must be different users.',
          );
        }

        const version = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            versionNumber: document.currentVersionNumber,
          },
          select: { id: true, status: true, createdByUserId: true },
        });
        if (!version || version.status !== 'DRAFT') {
          throw documentWorkflowConflict();
        }
        if (
          input.reviewerUserId === version.createdByUserId ||
          input.approverUserId === version.createdByUserId
        ) {
          throw documentWorkflowInvalid(
            'The version author cannot review or approve their own work.',
          );
        }

        await requireQualifiedAssignee(
          transaction,
          principal.tenantId,
          input.reviewerUserId,
          'documents.review',
          'The selected reviewer is not active or lacks review permission.',
        );
        await requireQualifiedAssignee(
          transaction,
          principal.tenantId,
          input.approverUserId,
          'documents.approve',
          'The selected approver is not active or lacks approval permission.',
        );

        const previousWorkflow = await transaction.documentWorkflow.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentVersionId: version.id,
          },
          select: { id: true },
        });
        if (previousWorkflow) {
          throw documentWorkflowConflict(
            'This version already has a decision history. Create a new version before resubmitting.',
          );
        }

        const claimedDocument = await transaction.document.updateMany({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            status: document.status,
            currentVersionNumber: document.currentVersionNumber,
          },
          data: {
            status: document.status === 'EFFECTIVE' ? 'EFFECTIVE' : 'IN_REVIEW',
          },
        });
        const claimedVersion = await transaction.documentVersion.updateMany({
          where: {
            id: version.id,
            tenantId: principal.tenantId,
            status: 'DRAFT',
          },
          data: { status: 'IN_REVIEW' },
        });
        if (claimedDocument.count !== 1 || claimedVersion.count !== 1) {
          throw documentWorkflowConflict();
        }

        try {
          await transaction.documentWorkflow.create({
            data: {
              tenantId: principal.tenantId,
              documentId,
              documentVersionId: version.id,
              requestedByUserId: principal.userId,
              reviewerUserId: input.reviewerUserId,
              approverUserId: input.approverUserId,
            },
          });
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw documentWorkflowConflict();
          throw error;
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'DOCUMENT_REVIEW_REQUESTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: version.id,
            versionNumber: document.currentVersionNumber,
            reviewerUserId: input.reviewerUserId,
            approverUserId: input.approverUserId,
          },
        });
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }

  reviewDecision(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: DocumentDecisionDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const context = await decisionContext(
          transaction,
          principal.tenantId,
          documentId,
        );
        if (context.workflow.reviewerUserId !== principal.userId) {
          throw documentDecisionForbidden(
            'Only the assigned reviewer can record this decision.',
          );
        }
        if (context.workflow.status !== 'PENDING_REVIEW') {
          throw documentWorkflowConflict();
        }

        const now = new Date();
        const accepted = input.decision === 'APPROVE';
        const claimed = await transaction.documentWorkflow.updateMany({
          where: {
            id: context.workflow.id,
            tenantId: principal.tenantId,
            status: 'PENDING_REVIEW',
          },
          data: {
            status: accepted ? 'PENDING_APPROVAL' : 'REJECTED',
            reviewComment: input.comment,
            reviewedAt: now,
            completedAt: accepted ? null : now,
          },
        });
        if (claimed.count !== 1) throw documentWorkflowConflict();
        if (!accepted) {
          await restoreDraft(
            transaction,
            principal.tenantId,
            documentId,
            context.version.id,
          );
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: accepted
            ? 'DOCUMENT_REVIEW_COMPLETED'
            : 'DOCUMENT_REVIEW_REJECTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: context.version.id,
            decision: input.decision,
          },
        });
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }

  approvalDecision(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: DocumentDecisionDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const context = await decisionContext(
          transaction,
          principal.tenantId,
          documentId,
        );
        if (context.workflow.approverUserId !== principal.userId) {
          throw documentDecisionForbidden(
            'Only the assigned approver can record this decision.',
          );
        }
        if (context.workflow.status !== 'PENDING_APPROVAL') {
          throw documentWorkflowConflict();
        }

        const now = new Date();
        const accepted = input.decision === 'APPROVE';
        const claimed = await transaction.documentWorkflow.updateMany({
          where: {
            id: context.workflow.id,
            tenantId: principal.tenantId,
            status: 'PENDING_APPROVAL',
          },
          data: {
            status: accepted ? 'APPROVED' : 'REJECTED',
            approvalComment: input.comment,
            approvedAt: accepted ? now : null,
            completedAt: now,
          },
        });
        if (claimed.count !== 1) throw documentWorkflowConflict();

        const nextStatus = accepted ? 'APPROVED' : 'DRAFT';
        const nextDocumentStatus =
          context.document.status === 'EFFECTIVE' ? 'EFFECTIVE' : nextStatus;
        const updatedDocument = await transaction.document.updateMany({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            status: context.document.status,
            currentVersionNumber: context.document.currentVersionNumber,
          },
          data: { status: nextDocumentStatus },
        });
        const updatedVersion = await transaction.documentVersion.updateMany({
          where: {
            id: context.version.id,
            tenantId: principal.tenantId,
            status: 'IN_REVIEW',
          },
          data: { status: nextStatus },
        });
        if (updatedDocument.count !== 1 || updatedVersion.count !== 1) {
          throw documentWorkflowConflict();
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: accepted
            ? 'DOCUMENT_APPROVED'
            : 'DOCUMENT_APPROVAL_REJECTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: context.version.id,
            decision: input.decision,
          },
        });
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }

  async release(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: ReleaseDocumentDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
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
          eventType: 'DOCUMENT_RELEASE_REAUTHENTICATION_FAILED',
          outcome: 'FAILURE',
          request,
          metadata: { documentId },
        }),
      );
      throw reauthenticationFailed();
    }

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const effectiveAt = new Date(input.effectiveAt);
        const document = await transaction.document.findFirst({
          where: { id: documentId, tenantId: principal.tenantId },
          select: {
            id: true,
            code: true,
            type: true,
            status: true,
            currentVersionNumber: true,
            periodicReviewIntervalMonths: true,
            periodicReviewReviewerUserId: true,
          },
        });
        if (!document) throw documentNotFound();
        if (document.status !== 'APPROVED' && document.status !== 'EFFECTIVE') {
          throw documentReleaseConflict();
        }

        const effectiveVersion = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            status: 'EFFECTIVE',
          },
          select: {
            id: true,
            versionNumber: true,
            release: { select: { id: true, recordHash: true } },
          },
        });
        if (
          (document.status === 'EFFECTIVE' && !effectiveVersion?.release) ||
          (document.status === 'APPROVED' && effectiveVersion)
        ) {
          throw documentReleaseConflict();
        }

        const pendingPeriodicReview = effectiveVersion
          ? await transaction.documentPeriodicReview.findFirst({
              where: {
                tenantId: principal.tenantId,
                documentId,
                status: 'PENDING',
              },
              select: { id: true },
            })
          : null;
        const openTrainingAssignments = effectiveVersion
          ? await transaction.trainingAssignment.findMany({
              where: {
                tenantId: principal.tenantId,
                documentVersionId: effectiveVersion.id,
                status: 'ASSIGNED',
              },
              select: { id: true },
            })
          : [];

        const version = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            versionNumber: document.currentVersionNumber,
          },
          select: {
            id: true,
            versionNumber: true,
            title: true,
            description: true,
            content: true,
            changeSummary: true,
            status: true,
            createdByUserId: true,
          },
        });
        if (!version || version.status !== 'APPROVED') {
          throw documentReleaseConflict();
        }
        const periodicReviewReviewer =
          document.periodicReviewIntervalMonths &&
          document.periodicReviewReviewerUserId &&
          document.periodicReviewReviewerUserId !== version.createdByUserId
            ? await transaction.user.findFirst({
                where: {
                  id: document.periodicReviewReviewerUserId,
                  tenantId: principal.tenantId,
                  status: 'ACTIVE',
                  userRoles: {
                    some: {
                      role: {
                        rolePermissions: {
                          some: {
                            permission: { code: 'documents.review' },
                          },
                        },
                      },
                    },
                  },
                },
                select: { id: true },
              })
            : null;
        const workflow = await transaction.documentWorkflow.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentVersionId: version.id,
            status: 'APPROVED',
          },
          select: { approverUserId: true, approvedAt: true },
        });
        if (!workflow?.approvedAt) throw documentReleaseConflict();
        if (
          principal.userId === version.createdByUserId ||
          principal.userId === workflow.approverUserId
        ) {
          throw documentReleaseInvalid(
            'The version author and approver cannot release the document.',
          );
        }
        if (
          effectiveAt.getTime() < workflow.approvedAt.getTime() ||
          effectiveAt.getTime() > now.getTime()
        ) {
          throw documentReleaseInvalid(
            'The effective timestamp must be between approval and the current time.',
          );
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

        const existingRelease = await transaction.documentRelease.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentVersionId: version.id,
          },
          select: { id: true },
        });
        if (existingRelease) throw documentReleaseConflict();

        const recordHash = hashDocumentLifecycleRecord({
          schemaVersion: 1,
          documentId,
          documentVersionId: version.id,
          versionNumber: version.versionNumber,
          code: document.code,
          type: document.type,
          title: version.title,
          description: version.description,
          content: version.content,
          changeSummary: version.changeSummary,
          approvedAt: workflow.approvedAt.toISOString(),
          releasedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'DOCUMENT_RELEASE',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          reason: input.reason,
          effectiveAt: effectiveAt.toISOString(),
          releasedAt: now.toISOString(),
          supersedesVersionNumber: effectiveVersion?.versionNumber ?? null,
          supersedesReleaseHash: effectiveVersion?.release?.recordHash ?? null,
        });

        const claimedDocument = await transaction.document.updateMany({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            status: document.status,
            currentVersionNumber: document.currentVersionNumber,
          },
          data: {
            status: 'EFFECTIVE',
            ...(!periodicReviewReviewer && document.periodicReviewReviewerUserId
              ? {
                  periodicReviewIntervalMonths: null,
                  periodicReviewReviewerUserId: null,
                }
              : {}),
          },
        });
        const claimedVersion = await transaction.documentVersion.updateMany({
          where: {
            id: version.id,
            tenantId: principal.tenantId,
            status: 'APPROVED',
          },
          data: { status: 'EFFECTIVE' },
        });
        const supersededVersion = effectiveVersion
          ? await transaction.documentVersion.updateMany({
              where: {
                id: effectiveVersion.id,
                tenantId: principal.tenantId,
                status: 'EFFECTIVE',
              },
              data: { status: 'SUPERSEDED' },
            })
          : null;
        const cancelledPeriodicReview = pendingPeriodicReview
          ? await transaction.documentPeriodicReview.updateMany({
              where: {
                id: pendingPeriodicReview.id,
                tenantId: principal.tenantId,
                status: 'PENDING',
              },
              data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancellationReason: 'VERSION_SUPERSEDED',
              },
            })
          : null;
        const cancelledTrainingAssignments = openTrainingAssignments.length
          ? await transaction.trainingAssignment.updateMany({
              where: {
                tenantId: principal.tenantId,
                id: { in: openTrainingAssignments.map(({ id }) => id) },
                status: 'ASSIGNED',
              },
              data: {
                status: 'CANCELLED',
                cancelledByUserId: principal.userId,
                cancelledAt: now,
                cancellationReason: 'VERSION_SUPERSEDED',
              },
            })
          : null;
        if (
          claimedDocument.count !== 1 ||
          claimedVersion.count !== 1 ||
          (supersededVersion && supersededVersion.count !== 1) ||
          (cancelledPeriodicReview && cancelledPeriodicReview.count !== 1) ||
          (cancelledTrainingAssignments &&
            cancelledTrainingAssignments.count !==
              openTrainingAssignments.length)
        ) {
          throw documentReleaseConflict();
        }

        let releaseId: string;
        try {
          const release = await transaction.documentRelease.create({
            data: {
              tenantId: principal.tenantId,
              documentId,
              documentVersionId: version.id,
              releasedByUserId: principal.userId,
              sessionId: principal.sessionId,
              reason: input.reason,
              effectiveAt,
              releasedAt: now,
              recordHash,
            },
            select: { id: true },
          });
          releaseId = release.id;
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) throw documentReleaseConflict();
          throw error;
        }

        let nextPeriodicReviewId: string | undefined;
        let nextPeriodicReviewDueAt: Date | undefined;
        if (periodicReviewReviewer && document.periodicReviewIntervalMonths) {
          nextPeriodicReviewDueAt = addUtcMonths(
            effectiveAt,
            document.periodicReviewIntervalMonths,
          );
          try {
            const periodicReview =
              await transaction.documentPeriodicReview.create({
                data: {
                  tenantId: principal.tenantId,
                  documentId,
                  documentVersionId: version.id,
                  assignedToUserId: periodicReviewReviewer.id,
                  scheduledByUserId: principal.userId,
                  intervalMonths: document.periodicReviewIntervalMonths,
                  dueAt: nextPeriodicReviewDueAt,
                },
                select: { id: true },
              });
            nextPeriodicReviewId = periodicReview.id;
          } catch (error: unknown) {
            if (isUniqueConstraintError(error)) {
              throw documentReleaseConflict();
            }
            throw error;
          }
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'DOCUMENT_RELEASED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: version.id,
            versionNumber: version.versionNumber,
            releaseId,
            effectiveAt: effectiveAt.toISOString(),
            meaning: 'DOCUMENT_RELEASE',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
            supersededVersionNumber: effectiveVersion?.versionNumber,
            supersededReleaseId: effectiveVersion?.release?.id,
            cancelledPeriodicReviewId: pendingPeriodicReview?.id,
            nextPeriodicReviewId,
            nextPeriodicReviewDueAt: nextPeriodicReviewDueAt?.toISOString(),
            cancelledTrainingAssignmentIds: openTrainingAssignments.map(
              ({ id }) => id,
            ),
          },
        });
        if (effectiveVersion) {
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'DOCUMENT_VERSION_SUPERSEDED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              documentId,
              supersededDocumentVersionId: effectiveVersion.id,
              supersededVersionNumber: effectiveVersion.versionNumber,
              replacementDocumentVersionId: version.id,
              replacementVersionNumber: version.versionNumber,
            },
          });
        }
        if (pendingPeriodicReview || nextPeriodicReviewId) {
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: periodicReviewReviewer?.id,
            eventType: 'DOCUMENT_PERIODIC_REVIEW_RESCHEDULED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              documentId,
              cancelledPeriodicReviewId: pendingPeriodicReview?.id,
              nextPeriodicReviewId,
              nextPeriodicReviewDueAt: nextPeriodicReviewDueAt?.toISOString(),
              versionNumber: version.versionNumber,
            },
          });
        }
        if (openTrainingAssignments.length) {
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'TRAINING_ASSIGNMENTS_CANCELLED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              documentId,
              documentVersionId: effectiveVersion?.id,
              assignmentIds: openTrainingAssignments.map(({ id }) => id),
              reason: 'VERSION_SUPERSEDED',
            },
          });
        }
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }

  async obsolete(
    principal: AuthenticatedPrincipal,
    documentId: string,
    input: ObsoleteDocumentDto,
    request: RequestMetadata,
  ): Promise<DocumentDetailResponseDto> {
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
          eventType: 'DOCUMENT_OBSOLESCENCE_REAUTHENTICATION_FAILED',
          outcome: 'FAILURE',
          request,
          metadata: { documentId },
        }),
      );
      throw reauthenticationFailed();
    }

    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const document = await transaction.document.findFirst({
          where: { id: documentId, tenantId: principal.tenantId },
          select: {
            id: true,
            code: true,
            type: true,
            status: true,
            currentVersionNumber: true,
          },
        });
        if (!document) throw documentNotFound();
        if (document.status !== 'EFFECTIVE') {
          throw documentObsolescenceConflict();
        }

        const version = await transaction.documentVersion.findFirst({
          where: {
            tenantId: principal.tenantId,
            documentId,
            status: 'EFFECTIVE',
          },
          select: {
            id: true,
            versionNumber: true,
            title: true,
            description: true,
            content: true,
            changeSummary: true,
            createdByUserId: true,
            workflow: {
              select: { approverUserId: true, approvedAt: true },
            },
            release: {
              select: { id: true, recordHash: true, effectiveAt: true },
            },
          },
        });
        if (
          !version?.workflow?.approvedAt ||
          !version.release ||
          version.versionNumber !== document.currentVersionNumber
        ) {
          throw documentObsolescenceConflict(
            'Resolve the active revision before obsoleting this document.',
          );
        }
        if (
          principal.userId === version.createdByUserId ||
          principal.userId === version.workflow.approverUserId
        ) {
          throw documentObsolescenceInvalid(
            'The version author and approver cannot obsolete the document.',
          );
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

        const existing = await transaction.documentObsolescence.findFirst({
          where: { tenantId: principal.tenantId, documentId },
          select: { id: true },
        });
        if (existing) throw documentObsolescenceConflict();

        const pendingPeriodicReview =
          await transaction.documentPeriodicReview.findFirst({
            where: {
              tenantId: principal.tenantId,
              documentId,
              status: 'PENDING',
            },
            select: { id: true },
          });
        const openTrainingAssignments =
          await transaction.trainingAssignment.findMany({
            where: {
              tenantId: principal.tenantId,
              documentVersionId: version.id,
              status: 'ASSIGNED',
            },
            select: { id: true },
          });

        const recordHash = hashDocumentLifecycleRecord({
          schemaVersion: 1,
          documentId,
          documentVersionId: version.id,
          versionNumber: version.versionNumber,
          code: document.code,
          type: document.type,
          title: version.title,
          description: version.description,
          content: version.content,
          changeSummary: version.changeSummary,
          approvedAt: version.workflow.approvedAt.toISOString(),
          effectiveAt: version.release.effectiveAt.toISOString(),
          releaseRecordHash: version.release.recordHash,
          obsoletedByUserId: principal.userId,
          sessionId: principal.sessionId,
          meaning: 'DOCUMENT_OBSOLESCENCE',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          attestationAccepted: true,
          reason: input.reason,
          obsoletedAt: now.toISOString(),
        });

        const claimedDocument = await transaction.document.updateMany({
          where: {
            id: documentId,
            tenantId: principal.tenantId,
            status: 'EFFECTIVE',
            currentVersionNumber: document.currentVersionNumber,
          },
          data: {
            status: 'OBSOLETE',
            periodicReviewIntervalMonths: null,
            periodicReviewReviewerUserId: null,
          },
        });
        const claimedVersion = await transaction.documentVersion.updateMany({
          where: {
            id: version.id,
            tenantId: principal.tenantId,
            status: 'EFFECTIVE',
          },
          data: { status: 'OBSOLETE' },
        });
        if (claimedDocument.count !== 1 || claimedVersion.count !== 1) {
          throw documentObsolescenceConflict();
        }

        if (pendingPeriodicReview) {
          const cancelledPeriodicReview =
            await transaction.documentPeriodicReview.updateMany({
              where: {
                id: pendingPeriodicReview.id,
                tenantId: principal.tenantId,
                status: 'PENDING',
              },
              data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancellationReason: 'DOCUMENT_OBSOLETED',
              },
            });
          if (cancelledPeriodicReview.count !== 1) {
            throw documentObsolescenceConflict();
          }
        }
        if (openTrainingAssignments.length) {
          const cancelledTrainingAssignments =
            await transaction.trainingAssignment.updateMany({
              where: {
                tenantId: principal.tenantId,
                id: { in: openTrainingAssignments.map(({ id }) => id) },
                status: 'ASSIGNED',
              },
              data: {
                status: 'CANCELLED',
                cancelledByUserId: principal.userId,
                cancelledAt: now,
                cancellationReason: 'DOCUMENT_OBSOLETED',
              },
            });
          if (
            cancelledTrainingAssignments.count !==
            openTrainingAssignments.length
          ) {
            throw documentObsolescenceConflict();
          }
        }

        let obsolescenceId: string;
        try {
          const obsolescence = await transaction.documentObsolescence.create({
            data: {
              tenantId: principal.tenantId,
              documentId,
              documentVersionId: version.id,
              obsoletedByUserId: principal.userId,
              sessionId: principal.sessionId,
              reason: input.reason,
              obsoletedAt: now,
              recordHash,
            },
            select: { id: true },
          });
          obsolescenceId = obsolescence.id;
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) {
            throw documentObsolescenceConflict();
          }
          throw error;
        }

        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'DOCUMENT_OBSOLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            documentId,
            documentVersionId: version.id,
            versionNumber: version.versionNumber,
            releaseId: version.release.id,
            obsolescenceId,
            meaning: 'DOCUMENT_OBSOLESCENCE',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            recordHash,
            cancelledPeriodicReviewId: pendingPeriodicReview?.id,
            cancelledTrainingAssignmentIds: openTrainingAssignments.map(
              ({ id }) => id,
            ),
          },
        });
        if (pendingPeriodicReview) {
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'DOCUMENT_PERIODIC_REVIEW_CANCELLED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              documentId,
              documentVersionId: version.id,
              periodicReviewId: pendingPeriodicReview.id,
              reason: 'DOCUMENT_OBSOLETED',
            },
          });
        }
        if (openTrainingAssignments.length) {
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'TRAINING_ASSIGNMENTS_CANCELLED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              documentId,
              documentVersionId: version.id,
              assignmentIds: openTrainingAssignments.map(({ id }) => id),
              reason: 'DOCUMENT_OBSOLETED',
            },
          });
        }
        return readDocument(transaction, principal.tenantId, documentId);
      },
    );
  }
}

function mapDocumentSummary(
  document: DocumentSummaryRecord,
  now = new Date(),
): DocumentSummaryResponseDto {
  const currentVersion = document.versions[0];
  const pendingPeriodicReview = document.periodicReviews.find(
    ({ status }) => status === 'PENDING',
  );
  if (!currentVersion) {
    throw new Error('Document invariant violated: current version is missing.');
  }
  return {
    id: document.id,
    code: document.code,
    type: document.type,
    status: document.status,
    currentVersionNumber: document.currentVersionNumber,
    owner: mapUser(document.ownerUser),
    createdBy: mapUser(document.createdByUser),
    currentVersion: mapVersionSummary(currentVersion),
    periodicReviewIntervalMonths: document.periodicReviewIntervalMonths,
    periodicReviewReviewer: document.periodicReviewReviewer
      ? mapUser(document.periodicReviewReviewer)
      : null,
    periodicReview: pendingPeriodicReview
      ? mapPeriodicReview(pendingPeriodicReview, now)
      : null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function mapDocumentDetail(
  document: DocumentDetailRecord,
): DocumentDetailResponseDto {
  const summary = mapDocumentSummary(document);
  return {
    ...summary,
    versions: document.versions.map(mapVersion),
    workflows: document.workflows.map(mapWorkflow),
    releases: document.releases.map(mapRelease),
    obsolescences: document.obsolescences.map(mapObsolescence),
    periodicReviews: document.periodicReviews.map((review) =>
      mapPeriodicReview(review),
    ),
  };
}

function mapPeriodicReview(
  review: DocumentPeriodicReviewRecord,
  now = new Date(),
): DocumentPeriodicReviewResponseDto {
  return {
    id: review.id,
    documentVersionId: review.documentVersion.id,
    versionNumber: review.documentVersion.versionNumber,
    assignedTo: mapUser(review.assignedToUser),
    scheduledBy: mapUser(review.scheduledByUser),
    intervalMonths: review.intervalMonths,
    status: review.status,
    dueState: periodicReviewDueState(review.status, review.dueAt, now),
    dueAt: review.dueAt.toISOString(),
    decision: review.decision,
    comment: review.comment,
    completedAt: review.completedAt?.toISOString() ?? null,
    cancelledAt: review.cancelledAt?.toISOString() ?? null,
    cancellationReason: review.cancellationReason,
    createdAt: review.createdAt.toISOString(),
  };
}

function mapObsolescence(
  obsolescence: DocumentObsolescenceRecord,
): DocumentObsolescenceResponseDto {
  return {
    id: obsolescence.id,
    documentVersionId: obsolescence.documentVersion.id,
    versionNumber: obsolescence.documentVersion.versionNumber,
    meaning: obsolescence.meaning,
    authenticationMethod: obsolescence.authenticationMethod,
    reason: obsolescence.reason,
    obsoletedBy: mapUser(obsolescence.obsoletedByUser),
    obsoletedAt: obsolescence.obsoletedAt.toISOString(),
    recordHash: obsolescence.recordHash,
  };
}

function mapRelease(
  release: DocumentReleaseRecord,
): DocumentReleaseResponseDto {
  return {
    id: release.id,
    documentVersionId: release.documentVersion.id,
    versionNumber: release.documentVersion.versionNumber,
    meaning: release.meaning,
    authenticationMethod: release.authenticationMethod,
    reason: release.reason,
    releasedBy: mapUser(release.releasedByUser),
    effectiveAt: release.effectiveAt.toISOString(),
    releasedAt: release.releasedAt.toISOString(),
    recordHash: release.recordHash,
  };
}

function mapWorkflow(
  workflow: DocumentWorkflowRecord,
): DocumentWorkflowResponseDto {
  return {
    id: workflow.id,
    documentVersionId: workflow.documentVersion.id,
    versionNumber: workflow.documentVersion.versionNumber,
    status: workflow.status,
    requestedBy: mapUser(workflow.requestedByUser),
    reviewer: mapUser(workflow.reviewerUser),
    approver: mapUser(workflow.approverUser),
    reviewComment: workflow.reviewComment,
    approvalComment: workflow.approvalComment,
    reviewedAt: workflow.reviewedAt?.toISOString() ?? null,
    approvedAt: workflow.approvedAt?.toISOString() ?? null,
    completedAt: workflow.completedAt?.toISOString() ?? null,
    createdAt: workflow.createdAt.toISOString(),
  };
}

function mapVersionSummary(
  version: DocumentVersionRecord,
): DocumentVersionSummaryDto {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    description: version.description,
    changeSummary: version.changeSummary,
    status: version.status,
    createdBy: mapUser(version.createdByUser),
    createdAt: version.createdAt.toISOString(),
  };
}

function mapVersion(
  version: DocumentVersionRecord,
): DocumentVersionResponseDto {
  return { ...mapVersionSummary(version), content: version.content };
}

function mapUser(user: DocumentUserSummaryDto): DocumentUserSummaryDto {
  return user;
}

function documentNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentNotFound,
    'The document was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function documentInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function documentCodeExists(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentCodeExists,
    'A document with this code already exists.',
    HttpStatus.CONFLICT,
  );
}

function documentVersionConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentVersionConflict,
    'The document version changed. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function documentWorkflowInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentWorkflowInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function documentWorkflowConflict(
  message = 'The document workflow changed. Reload and try again.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentWorkflowConflict,
    message,
    HttpStatus.CONFLICT,
  );
}

function documentDecisionForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentDecisionForbidden,
    message,
    HttpStatus.FORBIDDEN,
  );
}

function documentReleaseInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentReleaseInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function documentReleaseConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentReleaseConflict,
    'The document release changed. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function documentObsolescenceInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentObsolescenceInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function documentObsolescenceConflict(
  message = 'The document obsolescence changed. Reload and try again.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentObsolescenceConflict,
    message,
    HttpStatus.CONFLICT,
  );
}

function documentPeriodicReviewInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentPeriodicReviewInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function documentPeriodicReviewConflict(
  message = 'The periodic review changed. Reload and try again.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.DocumentPeriodicReviewConflict,
    message,
    HttpStatus.CONFLICT,
  );
}

function reauthenticationFailed(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ReauthenticationFailed,
    'Reauthentication failed.',
    HttpStatus.FORBIDDEN,
  );
}

async function requireQualifiedAssignee(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  permission: string,
  message: string,
  errorFactory: (message: string) => ApplicationError = documentWorkflowInvalid,
): Promise<void> {
  const user = await transaction.user.findFirst({
    where: {
      id: userId,
      tenantId,
      status: 'ACTIVE',
      userRoles: {
        some: {
          role: {
            rolePermissions: {
              some: { permission: { code: permission } },
            },
          },
        },
      },
    },
    select: { id: true },
  });
  if (!user) throw errorFactory(message);
}

async function decisionContext(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  documentId: string,
) {
  const document = await transaction.document.findFirst({
    where: { id: documentId, tenantId },
    select: { id: true, status: true, currentVersionNumber: true },
  });
  if (!document) throw documentNotFound();
  const version = await transaction.documentVersion.findFirst({
    where: {
      tenantId,
      documentId,
      versionNumber: document.currentVersionNumber,
    },
    select: { id: true },
  });
  if (!version) throw documentWorkflowConflict();
  const workflow = await transaction.documentWorkflow.findFirst({
    where: { tenantId, documentVersionId: version.id },
    select: {
      id: true,
      reviewerUserId: true,
      approverUserId: true,
      status: true,
    },
  });
  if (!workflow) throw documentWorkflowConflict();
  return { document, version, workflow };
}

async function restoreDraft(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  documentId: string,
  documentVersionId: string,
): Promise<void> {
  const currentDocument = await transaction.document.findFirst({
    where: { id: documentId, tenantId },
    select: { status: true, currentVersionNumber: true },
  });
  if (
    !currentDocument ||
    (currentDocument.status !== 'IN_REVIEW' &&
      currentDocument.status !== 'EFFECTIVE')
  ) {
    throw documentWorkflowConflict();
  }
  const document = await transaction.document.updateMany({
    where: {
      id: documentId,
      tenantId,
      status: currentDocument.status,
      currentVersionNumber: currentDocument.currentVersionNumber,
    },
    data: {
      status: currentDocument.status === 'EFFECTIVE' ? 'EFFECTIVE' : 'DRAFT',
    },
  });
  const version = await transaction.documentVersion.updateMany({
    where: { id: documentVersionId, tenantId, status: 'IN_REVIEW' },
    data: { status: 'DRAFT' },
  });
  if (document.count !== 1 || version.count !== 1) {
    throw documentWorkflowConflict();
  }
}

async function readDocument(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  documentId: string,
): Promise<DocumentDetailResponseDto> {
  const document = await transaction.document.findFirst({
    where: { id: documentId, tenantId },
    include: documentDetails,
  });
  if (!document) throw documentNotFound();
  return mapDocumentDetail(document);
}

function hashDocumentLifecycleRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function addUtcMonths(value: Date, months: number): Date {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

function periodicReviewDueState(
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED',
  dueAt: Date,
  now: Date,
): 'UPCOMING' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED' {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  const dueSoonThreshold = now.getTime() + 30 * 24 * 60 * 60 * 1000;
  return dueAt.getTime() <= dueSoonThreshold ? 'DUE_SOON' : 'UPCOMING';
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002',
  );
}

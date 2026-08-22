import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { productReviewAccessWhere } from '../../authorization/application/record-access.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CancelProductReviewDto,
  CreateProductReviewDto,
  DecideProductReviewDto,
  PrepareProductReviewDto,
  ProductReviewListQueryDto,
  ProductReviewTrendQueryDto,
} from './dto/product-review-request.dto.js';
import type {
  ProductReviewDetailResponseDto,
  ProductReviewParticipantResponseDto,
  ProductReviewSummaryResponseDto,
  ProductReviewTrendSnapshotDto,
} from './dto/product-review-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const reviewInclude = {
  approver: { select: userSummary },
  createdBy: { select: userSummary },
  cancelledBy: { select: userSummary },
  assessment: { include: { preparedBy: { select: userSummary } } },
  decision: { include: { decidedBy: { select: userSummary } } },
} satisfies Prisma.ProductQualityReviewInclude;

type ReviewRecord = Prisma.ProductQualityReviewGetPayload<{
  include: typeof reviewInclude;
}>;

const productReviewPermissions = [
  'product_reviews.read',
  'product_reviews.create',
  'product_reviews.prepare',
  'product_reviews.approve',
  'product_reviews.cancel',
];

@Injectable()
export class ProductReviewsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  listParticipants(
    principal: AuthenticatedPrincipal,
  ): Promise<ProductReviewParticipantResponseDto[]> {
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
            ? productReviewPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('product_reviews.'));
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
    query: ProductReviewListQueryDto,
  ): Promise<ProductReviewSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const reviews = await transaction.productQualityReview.findMany({
          where: {
            tenantId: principal.tenantId,
            AND: [productReviewAccessWhere(principal)],
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    {
                      productName: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      productCode: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      marketAuthorization: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { periodEnd: 'desc' }],
          include: reviewInclude,
        });
        const now = new Date();
        return reviews.map((review) => mapSummary(review, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    reviewId: string,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readReview(
            transaction,
            principal.tenantId,
            reviewId,
            productReviewAccessWhere(principal),
          ),
        ),
    );
  }

  trendPreview(
    principal: AuthenticatedPrincipal,
    query: ProductReviewTrendQueryDto,
  ): Promise<ProductReviewTrendSnapshotDto> {
    const period = reviewPeriod(query.periodStart, query.periodEnd);
    return this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
      buildTrendSnapshot(
        transaction,
        principal.tenantId,
        normalizeProductCode(query.productCode),
        period.start,
        period.end,
        new Date(),
      ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateProductReviewDto,
    request: RequestMetadata,
  ): Promise<ProductReviewDetailResponseDto> {
    const period = reviewPeriod(input.periodStart, input.periodEnd);
    const now = new Date();
    const targetCompletionAt = new Date(input.targetCompletionAt);
    if (
      period.end.getTime() > now.getTime() ||
      targetCompletionAt.getTime() <= now.getTime() ||
      input.approverUserId === principal.userId
    ) {
      throw productReviewInvalid(
        'The review requires a completed period, a future target date, and an independent approver.',
      );
    }
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await assertEligibleUser(
          transaction,
          principal.tenantId,
          input.approverUserId,
          'product_reviews.approve',
        );
        const productCode = normalizeProductCode(input.productCode);
        const duplicate = await transaction.productQualityReview.findFirst({
          where: {
            tenantId: principal.tenantId,
            productCode,
            periodStart: period.start,
            periodEnd: period.end,
          },
          select: { id: true },
        });
        if (duplicate) throw productReviewConflict();
        const year = now.getUTCFullYear();
        const sequence = await transaction.productReviewSequence.upsert({
          where: { tenantId_year: { tenantId: principal.tenantId, year } },
          create: { tenantId: principal.tenantId, year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `PQR-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.productQualityReview.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            code,
            productName: input.productName,
            productCode,
            dosageForm: input.dosageForm,
            strength: input.strength,
            marketAuthorization: input.marketAuthorization,
            periodStart: period.start,
            periodEnd: period.end,
            targetCompletionAt,
            approverUserId: input.approverUserId,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.approverUserId,
          eventType: 'PRODUCT_REVIEW_CREATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            productReviewId: created.id,
            code,
            productCode,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
        });
        return mapDetail(
          await readReview(transaction, principal.tenantId, created.id),
        );
      },
    );
  }

  async prepare(
    principal: AuthenticatedPrincipal,
    reviewId: string,
    input: PrepareProductReviewDto,
    request: RequestMetadata,
  ): Promise<ProductReviewDetailResponseDto> {
    if (
      input.batchesReleased + input.batchesRejected >
      input.batchesManufactured
    ) {
      throw productReviewInvalid(
        'Released and rejected batches cannot exceed manufactured batches.',
      );
    }
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'PRODUCT_REVIEW_ASSESSMENT_REAUTHENTICATION_FAILED',
      { reviewId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const review = await readReview(
          transaction,
          principal.tenantId,
          reviewId,
        );
        if (
          review.status !== 'DRAFT' ||
          review.assessment ||
          review.approverUserId === principal.userId
        ) {
          throw productReviewConflict();
        }
        const trendSnapshot = await buildTrendSnapshot(
          transaction,
          principal.tenantId,
          review.productCode,
          review.periodStart,
          review.periodEnd,
          now,
        );
        const record = {
          reviewId,
          ...assessmentInput(input),
          trendSnapshot,
          preparedByUserId: principal.userId,
          assessmentSessionId: principal.sessionId,
          meaning: 'REVIEW_ASSESSMENT',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          preparedAt: now.toISOString(),
        };
        await transaction.productReviewAssessment.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            productReviewId: reviewId,
            ...assessmentInput(input),
            trendSnapshot: trendSnapshot as unknown as Prisma.InputJsonValue,
            preparedByUserId: principal.userId,
            assessmentSessionId: principal.sessionId,
            preparedAt: now,
            recordHash: hashRecord(record),
          },
        });
        const changed = await transaction.productQualityReview.updateMany({
          where: {
            id: reviewId,
            tenantId: principal.tenantId,
            status: 'DRAFT',
          },
          data: { status: 'PENDING_APPROVAL' },
        });
        if (changed.count !== 1) throw productReviewConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: review.approverUserId,
          eventType: 'PRODUCT_REVIEW_ASSESSMENT_SIGNED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            productReviewId: reviewId,
            productCode: review.productCode,
            complaintCount: trendSnapshot.complaints.current,
            recallCount: trendSnapshot.recalls.current,
          },
        });
        return mapDetail(
          await readReview(transaction, principal.tenantId, reviewId),
        );
      },
    );
  }

  async decide(
    principal: AuthenticatedPrincipal,
    reviewId: string,
    input: DecideProductReviewDto,
    request: RequestMetadata,
  ): Promise<ProductReviewDetailResponseDto> {
    const nextReviewAt = new Date(input.nextReviewAt);
    if (
      nextReviewAt.getTime() <= Date.now() ||
      (input.decision === 'REQUIRE_FOLLOW_UP' &&
        input.followUpReference.trim().length < 3)
    ) {
      throw productReviewInvalid(
        'A future next-review date and a controlled follow-up reference are required.',
      );
    }
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'PRODUCT_REVIEW_DECISION_REAUTHENTICATION_FAILED',
      { reviewId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const review = await readReview(
          transaction,
          principal.tenantId,
          reviewId,
        );
        if (
          review.status !== 'PENDING_APPROVAL' ||
          review.decision ||
          review.approverUserId !== principal.userId ||
          review.assessment?.preparedByUserId === principal.userId
        ) {
          throw productReviewForbidden(
            'Only the independent assigned approver may sign this review.',
          );
        }
        const record = {
          reviewId,
          decision: input.decision,
          rationale: input.rationale,
          followUpReference: input.followUpReference,
          nextReviewAt: nextReviewAt.toISOString(),
          decidedByUserId: principal.userId,
          decisionSessionId: principal.sessionId,
          meaning: 'REVIEW_APPROVAL',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          decidedAt: now.toISOString(),
        };
        await transaction.productReviewDecision.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            productReviewId: reviewId,
            decision: input.decision,
            rationale: input.rationale,
            followUpReference: input.followUpReference,
            nextReviewAt,
            decidedByUserId: principal.userId,
            decisionSessionId: principal.sessionId,
            decidedAt: now,
            recordHash: hashRecord(record),
          },
        });
        const nextStatus =
          input.decision === 'APPROVE' ? 'APPROVED' : 'FOLLOW_UP_REQUIRED';
        const changed = await transaction.productQualityReview.updateMany({
          where: {
            id: reviewId,
            tenantId: principal.tenantId,
            status: 'PENDING_APPROVAL',
            approverUserId: principal.userId,
          },
          data: { status: nextStatus },
        });
        if (changed.count !== 1) throw productReviewConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'PRODUCT_REVIEW_DECIDED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            productReviewId: reviewId,
            decision: input.decision,
            nextReviewAt: nextReviewAt.toISOString(),
          },
        });
        return mapDetail(
          await readReview(transaction, principal.tenantId, reviewId),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    reviewId: string,
    input: CancelProductReviewDto,
    request: RequestMetadata,
  ): Promise<ProductReviewDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const review = await readReview(
          transaction,
          principal.tenantId,
          reviewId,
        );
        if (review.status !== 'DRAFT' || review.assessment) {
          throw productReviewConflict();
        }
        const now = new Date();
        const changed = await transaction.productQualityReview.updateMany({
          where: {
            id: reviewId,
            tenantId: principal.tenantId,
            status: 'DRAFT',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancellationReason: input.reason,
            cancelledAt: now,
          },
        });
        if (changed.count !== 1) throw productReviewConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'PRODUCT_REVIEW_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: { productReviewId: reviewId },
        });
        return mapDetail(
          await readReview(transaction, principal.tenantId, reviewId),
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

async function readReview(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  reviewId: string,
  accessWhere: Prisma.ProductQualityReviewWhereInput = {},
): Promise<ReviewRecord> {
  const review = await transaction.productQualityReview.findFirst({
    where: { id: reviewId, tenantId, AND: [accessWhere] },
    include: reviewInclude,
  });
  if (!review) throw productReviewNotFound();
  return review;
}

async function assertEligibleUser(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  permissionCode: string,
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
    throw productReviewInvalid(
      'The approver must be active and have product review approval permission.',
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

async function buildTrendSnapshot(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  productCode: string,
  periodStart: Date,
  periodEnd: Date,
  capturedAt: Date,
): Promise<ProductReviewTrendSnapshotDto> {
  const endExclusive = addUtcDays(periodEnd, 1);
  const periodDuration = endExclusive.getTime() - periodStart.getTime();
  const previousEndExclusive = periodStart;
  const previousStart = new Date(periodStart.getTime() - periodDuration);
  const [complaintRecords, recallRecords] = await Promise.all([
    transaction.productComplaint.findMany({
      where: {
        tenantId,
        productCode: { equals: productCode, mode: 'insensitive' },
        createdAt: { gte: previousStart, lt: endExclusive },
      },
      select: {
        createdAt: true,
        severity: true,
        regulatoryAssessment: true,
        decision: { select: { disposition: true } },
        investigation: {
          select: {
            deviationId: true,
            capaId: true,
            supplierId: true,
            qualityRiskId: true,
            changeControlId: true,
          },
        },
      },
    }),
    transaction.productRecall.findMany({
      where: {
        tenantId,
        productCode: { equals: productCode, mode: 'insensitive' },
        createdAt: { gte: previousStart, lt: endExclusive },
      },
      select: { createdAt: true, status: true },
    }),
  ]);
  const currentComplaints = complaintRecords.filter(
    ({ createdAt }) => createdAt >= periodStart,
  );
  const previousComplaints = complaintRecords.filter(
    ({ createdAt }) => createdAt < previousEndExclusive,
  );
  const currentRecalls = recallRecords.filter(
    ({ createdAt }) => createdAt >= periodStart,
  );
  const previousRecalls = recallRecords.filter(
    ({ createdAt }) => createdAt < previousEndExclusive,
  );
  const monthly = monthBuckets(periodStart, periodEnd).map((month) => ({
    month,
    complaints: currentComplaints.filter(
      ({ createdAt }) => monthKey(createdAt) === month,
    ).length,
    recalls: currentRecalls.filter(
      ({ createdAt }) => monthKey(createdAt) === month,
    ).length,
  }));
  const investigations = currentComplaints
    .map(({ investigation }) => investigation)
    .filter((value) => value !== null);
  return {
    productCode,
    periodStart: dateOnly(periodStart),
    periodEnd: dateOnly(periodEnd),
    previousPeriodStart: dateOnly(previousStart),
    previousPeriodEnd: dateOnly(addUtcDays(previousEndExclusive, -1)),
    complaints: trendMetric(
      currentComplaints.length,
      previousComplaints.length,
    ),
    recalls: trendMetric(currentRecalls.length, previousRecalls.length),
    substantiatedComplaints: currentComplaints.filter(
      ({ decision }) => decision?.disposition === 'SUBSTANTIATED',
    ).length,
    criticalComplaints: currentComplaints.filter(({ severity }) =>
      ['HIGH', 'CRITICAL'].includes(severity ?? ''),
    ).length,
    reportableComplaints: currentComplaints.filter(
      ({ regulatoryAssessment }) => regulatoryAssessment === 'REPORTABLE',
    ).length,
    closedRecalls: currentRecalls.filter(({ status }) => status === 'CLOSED')
      .length,
    linkedDeviations: distinctCount(investigations, 'deviationId'),
    linkedCapas: distinctCount(investigations, 'capaId'),
    linkedSuppliers: distinctCount(investigations, 'supplierId'),
    linkedQualityRisks: distinctCount(investigations, 'qualityRiskId'),
    linkedChangeControls: distinctCount(investigations, 'changeControlId'),
    monthly,
    capturedAt: capturedAt.toISOString(),
  };
}

function assessmentInput(input: PrepareProductReviewDto) {
  return {
    batchesManufactured: input.batchesManufactured,
    batchesReleased: input.batchesReleased,
    batchesRejected: input.batchesRejected,
    outOfSpecificationCount: input.outOfSpecificationCount,
    stabilityExceptionCount: input.stabilityExceptionCount,
    returnedUnitCount: input.returnedUnitCount,
    manufacturingSummary: input.manufacturingSummary,
    startingMaterialsSummary: input.startingMaterialsSummary,
    criticalQualityAttributesSummary: input.criticalQualityAttributesSummary,
    processPerformanceSummary: input.processPerformanceSummary,
    stabilitySummary: input.stabilitySummary,
    validationSummary: input.validationSummary,
    regulatorySummary: input.regulatorySummary,
    trendAnalysis: input.trendAnalysis,
    benefitRiskConclusion: input.benefitRiskConclusion,
    recommendations: input.recommendations,
    evidenceReference: input.evidenceReference,
    continuedManufactureRecommended: input.continuedManufactureRecommended,
    capaRequired: input.capaRequired,
    changeControlRequired: input.changeControlRequired,
  };
}

function mapSummary(
  review: ReviewRecord,
  now = new Date(),
): ProductReviewSummaryResponseDto {
  return {
    id: review.id,
    code: review.code,
    productName: review.productName,
    productCode: review.productCode,
    dosageForm: review.dosageForm,
    strength: review.strength,
    status: review.status,
    dueState: dueState(review, now),
    periodStart: dateOnly(review.periodStart),
    periodEnd: dateOnly(review.periodEnd),
    targetCompletionAt: review.targetCompletionAt.toISOString(),
    approver: review.approver,
    createdAt: review.createdAt.toISOString(),
  };
}

function mapDetail(review: ReviewRecord): ProductReviewDetailResponseDto {
  const assessment = review.assessment;
  const decision = review.decision;
  return {
    ...mapSummary(review),
    marketAuthorization: review.marketAuthorization,
    createdBy: review.createdBy,
    assessment: assessment
      ? {
          id: assessment.id,
          batchesManufactured: assessment.batchesManufactured,
          batchesReleased: assessment.batchesReleased,
          batchesRejected: assessment.batchesRejected,
          outOfSpecificationCount: assessment.outOfSpecificationCount,
          stabilityExceptionCount: assessment.stabilityExceptionCount,
          returnedUnitCount: assessment.returnedUnitCount,
          manufacturingSummary: assessment.manufacturingSummary,
          startingMaterialsSummary: assessment.startingMaterialsSummary,
          criticalQualityAttributesSummary:
            assessment.criticalQualityAttributesSummary,
          processPerformanceSummary: assessment.processPerformanceSummary,
          stabilitySummary: assessment.stabilitySummary,
          validationSummary: assessment.validationSummary,
          regulatorySummary: assessment.regulatorySummary,
          trendAnalysis: assessment.trendAnalysis,
          benefitRiskConclusion: assessment.benefitRiskConclusion,
          recommendations: assessment.recommendations,
          evidenceReference: assessment.evidenceReference,
          continuedManufactureRecommended:
            assessment.continuedManufactureRecommended,
          capaRequired: assessment.capaRequired,
          changeControlRequired: assessment.changeControlRequired,
          trendSnapshot: assessment.trendSnapshot,
          preparedBy: assessment.preparedBy,
          meaning: assessment.meaning,
          authenticationMethod: assessment.authenticationMethod,
          preparedAt: assessment.preparedAt.toISOString(),
          recordHash: assessment.recordHash,
        }
      : null,
    decision: decision
      ? {
          id: decision.id,
          decision: decision.decision,
          rationale: decision.rationale,
          followUpReference: decision.followUpReference,
          nextReviewAt: decision.nextReviewAt.toISOString(),
          decidedBy: decision.decidedBy,
          meaning: decision.meaning,
          authenticationMethod: decision.authenticationMethod,
          decidedAt: decision.decidedAt.toISOString(),
          recordHash: decision.recordHash,
        }
      : null,
    cancellationReason: review.cancellationReason,
    cancelledAt: review.cancelledAt?.toISOString() ?? null,
  };
}

function reviewPeriod(startValue: string, endValue: string) {
  const start = new Date(`${startValue.slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${endValue.slice(0, 10)}T00:00:00.000Z`);
  const duration = addUtcDays(end, 1).getTime() - start.getTime();
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end < start ||
    duration > 800 * 24 * 60 * 60 * 1000
  ) {
    throw productReviewInvalid(
      'The review period must be valid and no longer than 800 days.',
    );
  }
  return { start, end };
}

function trendMetric(current: number, previous: number) {
  const deltaPercent =
    previous === 0
      ? current === 0
        ? 0
        : null
      : Number((((current - previous) / previous) * 100).toFixed(1));
  const direction =
    previous === 0
      ? current === 0
        ? 'STABLE'
        : 'INCREASE'
      : Math.abs(deltaPercent ?? 0) <= 10
        ? 'STABLE'
        : current > previous
          ? 'INCREASE'
          : 'DECREASE';
  return { current, previous, deltaPercent, direction };
}

function distinctCount<T extends Record<string, string | null>>(
  records: T[],
  key: keyof T,
): number {
  return new Set(records.map((record) => record[key]).filter(Boolean)).size;
}

function monthBuckets(start: Date, end: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function monthKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeProductCode(value: string): string {
  return value.trim().toUpperCase();
}

function dueState(review: ReviewRecord, now: Date): string {
  if (review.status === 'APPROVED') return 'COMPLETED';
  if (review.status === 'FOLLOW_UP_REQUIRED') return 'FOLLOW_UP_REQUIRED';
  if (review.status === 'CANCELLED') return 'CANCELLED';
  if (review.targetCompletionAt < now) return 'OVERDUE';
  return review.targetCompletionAt.getTime() <=
    now.getTime() + 14 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function productReviewNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ProductReviewNotFound,
    'The product quality review was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function productReviewInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ProductReviewInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function productReviewConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ProductReviewConflict,
    'The product review changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function productReviewForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ProductReviewForbidden,
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

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
  CancelQualityRiskDto,
  CompleteQualityRiskItemDto,
  CreateQualityRiskDto,
  QualityRiskListQueryDto,
  ReviewQualityRiskDto,
} from './dto/quality-risk-request.dto.js';
import type {
  QualityRiskDetailResponseDto,
  QualityRiskReferencesResponseDto,
  QualityRiskSummaryResponseDto,
} from './dto/quality-risk-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const riskInclude = {
  owner: { select: userSummary },
  reviewer: { select: userSummary },
  createdBy: { select: userSummary },
  items: {
    orderBy: { sequenceNumber: 'asc' as const },
    include: {
      assignedTo: { select: userSummary },
      completedBy: { select: userSummary },
    },
  },
  review: { include: { reviewedBy: { select: userSummary } } },
} satisfies Prisma.QualityRiskAssessmentInclude;
type RiskRecord = Prisma.QualityRiskAssessmentGetPayload<{
  include: typeof riskInclude;
}>;

const riskPermissions = [
  'risks.read',
  'risks.create',
  'risks.mitigate',
  'risks.review',
];

@Injectable()
export class QualityRisksService {
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
            ? riskPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('risks.'));
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

  references(
    principal: AuthenticatedPrincipal,
  ): Promise<QualityRiskReferencesResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const [deviations, capas, changeControls, audits] = await Promise.all([
          transaction.deviation.findMany({
            where: { tenantId: principal.tenantId },
            take: 200,
            orderBy: { createdAt: 'desc' },
            select: { id: true, code: true, title: true },
          }),
          transaction.capa.findMany({
            where: { tenantId: principal.tenantId },
            take: 200,
            orderBy: { createdAt: 'desc' },
            select: { id: true, code: true, title: true },
          }),
          transaction.changeControl.findMany({
            where: { tenantId: principal.tenantId },
            take: 200,
            orderBy: { createdAt: 'desc' },
            select: { id: true, code: true, title: true },
          }),
          transaction.gmpAudit.findMany({
            where: { tenantId: principal.tenantId },
            take: 200,
            orderBy: { createdAt: 'desc' },
            select: { id: true, code: true, title: true },
          }),
        ]);
        return { deviations, capas, changeControls, audits };
      },
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: QualityRiskListQueryDto,
  ): Promise<QualityRiskSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const risks = await transaction.qualityRiskAssessment.findMany({
          where: {
            tenantId: principal.tenantId,
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    {
                      processArea: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { targetReviewAt: 'asc' }],
          include: riskInclude,
        });
        const now = new Date();
        return risks.map((risk) => mapSummary(risk, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    riskId: string,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(await readRisk(transaction, principal.tenantId, riskId)),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateQualityRiskDto,
    request: RequestMetadata,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const targetReviewAt = new Date(input.targetReviewAt);
        if (targetReviewAt.getTime() <= now.getTime()) {
          throw riskInvalid('The target review date must be in the future.');
        }
        if (
          input.reviewerUserId === input.ownerUserId ||
          input.reviewerUserId === principal.userId
        ) {
          throw riskInvalid(
            'The residual risk reviewer must be independent from the owner and creator.',
          );
        }
        if (
          input.items.some(
            ({ assignedToUserId }) => assignedToUserId === input.reviewerUserId,
          )
        ) {
          throw riskInvalid(
            'The independent reviewer cannot execute a mitigation in the same assessment.',
          );
        }
        for (const item of input.items) {
          const dueAt = new Date(item.dueAt);
          if (
            dueAt.getTime() <= now.getTime() ||
            dueAt.getTime() > targetReviewAt.getTime()
          ) {
            throw riskInvalid(
              'Every mitigation due date must be in the future and no later than the target review date.',
            );
          }
        }
        await Promise.all([
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.ownerUserId,
            'risks.create',
            'risk owner',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.reviewerUserId,
            'risks.review',
            'independent reviewer',
          ),
          ...input.items.map((item) =>
            assertEligibleUser(
              transaction,
              principal.tenantId,
              item.assignedToUserId,
              'risks.mitigate',
              'mitigation assignee',
            ),
          ),
          assertLinkedRecords(transaction, principal.tenantId, input),
        ]);
        const year = now.getUTCFullYear();
        const sequence = await transaction.qualityRiskSequence.upsert({
          where: { tenantId_year: { tenantId: principal.tenantId, year } },
          create: { tenantId: principal.tenantId, year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `QRM-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.qualityRiskAssessment.create({
          data: {
            tenantId: principal.tenantId,
            code,
            title: input.title,
            category: input.category,
            processArea: input.processArea,
            scope: input.scope,
            riskStatement: input.riskStatement,
            ownerUserId: input.ownerUserId,
            reviewerUserId: input.reviewerUserId,
            createdByUserId: principal.userId,
            targetReviewAt,
            deviationId: input.deviationId,
            capaId: input.capaId,
            changeControlId: input.changeControlId,
            auditId: input.auditId,
          },
          select: { id: true },
        });
        await transaction.qualityRiskItem.createMany({
          data: input.items.map((item, index) => ({
            tenantId: principal.tenantId,
            riskId: created.id,
            sequenceNumber: index + 1,
            failureMode: item.failureMode,
            cause: item.cause,
            effect: item.effect,
            currentControls: item.currentControls,
            initialSeverity: item.initialSeverity,
            initialProbability: item.initialProbability,
            initialDetectability: item.initialDetectability,
            initialRpn: rpn(
              item.initialSeverity,
              item.initialProbability,
              item.initialDetectability,
            ),
            mitigationPlan: item.mitigationPlan,
            assignedToUserId: item.assignedToUserId,
            dueAt: new Date(item.dueAt),
          })),
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.ownerUserId,
          eventType: 'QUALITY_RISK_ASSESSMENT_CREATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            riskId: created.id,
            code,
            method: 'FMEA',
            itemCount: input.items.length,
            reviewerUserId: input.reviewerUserId,
          },
        });
        return mapDetail(
          await readRisk(transaction, principal.tenantId, created.id),
        );
      },
    );
  }

  async completeItem(
    principal: AuthenticatedPrincipal,
    riskId: string,
    itemId: string,
    input: CompleteQualityRiskItemDto,
    request: RequestMetadata,
  ): Promise<QualityRiskDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'QUALITY_RISK_MITIGATION_REAUTHENTICATION_FAILED',
      { riskId, itemId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const risk = await readRisk(transaction, principal.tenantId, riskId);
        const item = risk.items.find(({ id }) => id === itemId);
        if (!item) throw riskNotFound('The FMEA item was not found.');
        if (risk.status !== 'OPEN' || item.status !== 'OPEN') {
          throw riskConflict();
        }
        if (item.assignedToUserId !== principal.userId) {
          throw riskForbidden(
            'Only the assigned user can sign this mitigation.',
          );
        }
        const residualRpn = rpn(
          input.residualSeverity,
          input.residualProbability,
          input.residualDetectability,
        );
        const recordHash = hashRecord({
          schemaVersion: 1,
          riskId: risk.id,
          riskCode: risk.code,
          itemId: item.id,
          sequenceNumber: item.sequenceNumber,
          initialRpn: item.initialRpn,
          completionEvidence: input.completionEvidence,
          residualSeverity: input.residualSeverity,
          residualProbability: input.residualProbability,
          residualDetectability: input.residualDetectability,
          residualRpn,
          completedByUserId: principal.userId,
          completionSessionId: principal.sessionId,
          meaning: 'MITIGATION_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          completedAt: now.toISOString(),
        });
        const changed = await transaction.qualityRiskItem.updateMany({
          where: {
            id: item.id,
            tenantId: principal.tenantId,
            riskId: risk.id,
            status: 'OPEN',
            assignedToUserId: principal.userId,
          },
          data: {
            status: 'COMPLETED',
            completionEvidence: input.completionEvidence,
            residualSeverity: input.residualSeverity,
            residualProbability: input.residualProbability,
            residualDetectability: input.residualDetectability,
            residualRpn,
            completedByUserId: principal.userId,
            completionSessionId: principal.sessionId,
            meaning: 'MITIGATION_COMPLETION',
            authenticationMethod: 'PASSWORD_REAUTHENTICATION',
            completedAt: now,
            recordHash,
          },
        });
        if (changed.count !== 1) throw riskConflict();
        const openCount = await transaction.qualityRiskItem.count({
          where: {
            tenantId: principal.tenantId,
            riskId: risk.id,
            status: 'OPEN',
          },
        });
        if (openCount === 0) {
          const advanced = await transaction.qualityRiskAssessment.updateMany({
            where: {
              tenantId: principal.tenantId,
              id: risk.id,
              status: 'OPEN',
            },
            data: { status: 'PENDING_REVIEW' },
          });
          if (advanced.count !== 1) throw riskConflict();
        }
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'QUALITY_RISK_MITIGATION_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            riskId: risk.id,
            code: risk.code,
            itemId: item.id,
            residualRpn,
            recordHash,
            pendingReview: openCount === 0,
          },
        });
        return mapDetail(
          await readRisk(transaction, principal.tenantId, risk.id),
        );
      },
    );
  }

  async review(
    principal: AuthenticatedPrincipal,
    riskId: string,
    input: ReviewQualityRiskDto,
    request: RequestMetadata,
  ): Promise<QualityRiskDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'QUALITY_RISK_REVIEW_REAUTHENTICATION_FAILED',
      { riskId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const risk = await readRisk(transaction, principal.tenantId, riskId);
        if (risk.status !== 'PENDING_REVIEW' || risk.review) {
          throw riskConflict();
        }
        if (risk.reviewerUserId !== principal.userId) {
          throw riskForbidden(
            'Only the assigned independent reviewer can sign the residual risk decision.',
          );
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          riskId: risk.id,
          riskCode: risk.code,
          mitigationRecordHashes: risk.items.map(
            ({ recordHash }) => recordHash,
          ),
          residualRpns: risk.items.map(({ residualRpn }) => residualRpn),
          decision: input.decision,
          rationale: input.rationale,
          reviewedByUserId: principal.userId,
          reviewSessionId: principal.sessionId,
          meaning: 'RESIDUAL_RISK_REVIEW',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          reviewedAt: now.toISOString(),
        });
        await transaction.qualityRiskReview.create({
          data: {
            id,
            tenantId: principal.tenantId,
            riskId: risk.id,
            decision: input.decision,
            rationale: input.rationale,
            reviewedByUserId: principal.userId,
            reviewSessionId: principal.sessionId,
            reviewedAt: now,
            recordHash,
          },
        });
        const status =
          input.decision === 'ACCEPT' ? 'CLOSED' : 'RESIDUAL_RISK_NOT_ACCEPTED';
        const changed = await transaction.qualityRiskAssessment.updateMany({
          where: {
            tenantId: principal.tenantId,
            id: risk.id,
            status: 'PENDING_REVIEW',
          },
          data: { status },
        });
        if (changed.count !== 1) throw riskConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'QUALITY_RISK_RESIDUAL_REVIEW_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            riskId: risk.id,
            code: risk.code,
            decision: input.decision,
            status,
            recordHash,
          },
        });
        return mapDetail(
          await readRisk(transaction, principal.tenantId, risk.id),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    riskId: string,
    input: CancelQualityRiskDto,
    request: RequestMetadata,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const risk = await readRisk(transaction, principal.tenantId, riskId);
        if (
          risk.status !== 'OPEN' ||
          risk.items.some(({ status }) => status === 'COMPLETED')
        ) {
          throw riskConflict();
        }
        const now = new Date();
        const changed = await transaction.qualityRiskAssessment.updateMany({
          where: {
            tenantId: principal.tenantId,
            id: risk.id,
            status: 'OPEN',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancelledAt: now,
            cancellationReason: input.reason,
          },
        });
        if (changed.count !== 1) throw riskConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'QUALITY_RISK_ASSESSMENT_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: { riskId: risk.id, code: risk.code, reason: input.reason },
        });
        return mapDetail(
          await readRisk(transaction, principal.tenantId, risk.id),
        );
      },
    );
  }

  private async reauthenticate(
    principal: AuthenticatedPrincipal,
    password: string,
    request: RequestMetadata,
    eventType: string,
    metadata: Record<string, unknown>,
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
    const matches = signer
      ? await this.passwordHasher
          .verify(signer.passwordHash, password)
          .catch(() => false)
      : false;
    if (!signer || !matches) {
      await this.tenantUnitOfWork.execute(principal.tenantId, (transaction) =>
        appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType,
          outcome: 'FAILURE',
          request,
          metadata: metadata as Prisma.InputJsonObject,
        }),
      );
      throw reauthenticationFailed();
    }
    return signer.passwordHash;
  }
}

async function readRisk(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  riskId: string,
): Promise<RiskRecord> {
  const risk = await transaction.qualityRiskAssessment.findFirst({
    where: { id: riskId, tenantId },
    include: riskInclude,
  });
  if (!risk) throw riskNotFound();
  return risk;
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
    throw riskInvalid(
      `The ${label} must be active and have the required permission.`,
    );
  }
}

async function assertLinkedRecords(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  input: Pick<
    CreateQualityRiskDto,
    'deviationId' | 'capaId' | 'changeControlId' | 'auditId'
  >,
): Promise<void> {
  const [deviation, capa, changeControl, audit] = await Promise.all([
    input.deviationId
      ? transaction.deviation.findFirst({
          where: { id: input.deviationId, tenantId },
          select: { id: true },
        })
      : Promise.resolve({ id: '' }),
    input.capaId
      ? transaction.capa.findFirst({
          where: { id: input.capaId, tenantId },
          select: { id: true },
        })
      : Promise.resolve({ id: '' }),
    input.changeControlId
      ? transaction.changeControl.findFirst({
          where: { id: input.changeControlId, tenantId },
          select: { id: true },
        })
      : Promise.resolve({ id: '' }),
    input.auditId
      ? transaction.gmpAudit.findFirst({
          where: { id: input.auditId, tenantId },
          select: { id: true },
        })
      : Promise.resolve({ id: '' }),
  ]);
  if (
    (input.deviationId && !deviation) ||
    (input.capaId && !capa) ||
    (input.changeControlId && !changeControl) ||
    (input.auditId && !audit)
  ) {
    throw riskInvalid(
      'Linked quality records must belong to the same organization.',
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

function mapSummary(
  risk: RiskRecord,
  now = new Date(),
): QualityRiskSummaryResponseDto {
  const residual = risk.items
    .map(({ residualRpn }) => residualRpn)
    .filter((value): value is number => value !== null);
  return {
    id: risk.id,
    code: risk.code,
    title: risk.title,
    category: risk.category,
    method: risk.method,
    processArea: risk.processArea,
    status: risk.status,
    dueState: dueState(risk.targetReviewAt, now, risk.status),
    owner: risk.owner,
    reviewer: risk.reviewer,
    targetReviewAt: risk.targetReviewAt.toISOString(),
    highestInitialRpn: Math.max(
      ...risk.items.map(({ initialRpn }) => initialRpn),
    ),
    highestResidualRpn: residual.length ? Math.max(...residual) : null,
    openItemCount: risk.items.filter(({ status }) => status === 'OPEN').length,
    itemCount: risk.items.length,
    createdAt: risk.createdAt.toISOString(),
  };
}

function mapDetail(risk: RiskRecord): QualityRiskDetailResponseDto {
  const now = new Date();
  return {
    ...mapSummary(risk, now),
    scope: risk.scope,
    riskStatement: risk.riskStatement,
    createdBy: risk.createdBy,
    deviationId: risk.deviationId,
    capaId: risk.capaId,
    changeControlId: risk.changeControlId,
    auditId: risk.auditId,
    items: risk.items.map((item) => ({
      id: item.id,
      sequenceNumber: item.sequenceNumber,
      failureMode: item.failureMode,
      cause: item.cause,
      effect: item.effect,
      currentControls: item.currentControls,
      initialSeverity: item.initialSeverity,
      initialProbability: item.initialProbability,
      initialDetectability: item.initialDetectability,
      initialRpn: item.initialRpn,
      initialLevel: riskLevel(item.initialRpn),
      mitigationPlan: item.mitigationPlan,
      assignedTo: item.assignedTo,
      dueAt: item.dueAt.toISOString(),
      dueState: dueState(item.dueAt, now, item.status),
      status: item.status,
      completionEvidence: item.completionEvidence,
      residualSeverity: item.residualSeverity,
      residualProbability: item.residualProbability,
      residualDetectability: item.residualDetectability,
      residualRpn: item.residualRpn,
      residualLevel:
        item.residualRpn === null ? null : riskLevel(item.residualRpn),
      completedBy: item.completedBy,
      meaning: item.meaning,
      authenticationMethod: item.authenticationMethod,
      completedAt: item.completedAt?.toISOString() ?? null,
      recordHash: item.recordHash,
    })),
    review: risk.review
      ? {
          decision: risk.review.decision,
          rationale: risk.review.rationale,
          reviewedBy: risk.review.reviewedBy,
          meaning: risk.review.meaning,
          authenticationMethod: risk.review.authenticationMethod,
          reviewedAt: risk.review.reviewedAt.toISOString(),
          recordHash: risk.review.recordHash,
        }
      : null,
    cancellationReason: risk.cancellationReason,
    cancelledAt: risk.cancelledAt?.toISOString() ?? null,
  };
}

function rpn(severity: number, probability: number, detectability: number) {
  return severity * probability * detectability;
}

function riskLevel(value: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (value <= 20) return 'LOW';
  if (value <= 50) return 'MEDIUM';
  if (value <= 80) return 'HIGH';
  return 'CRITICAL';
}

function dueState(
  dueAt: Date,
  now: Date,
  status: string,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (
    ['COMPLETED', 'CLOSED', 'RESIDUAL_RISK_NOT_ACCEPTED', 'CANCELLED'].includes(
      status,
    )
  ) {
    return 'COMPLETED';
  }
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  return dueAt.getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function riskNotFound(
  message = 'The quality risk assessment was not found.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.QualityRiskNotFound,
    message,
    HttpStatus.NOT_FOUND,
  );
}

function riskInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.QualityRiskInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function riskConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.QualityRiskConflict,
    'The quality risk assessment changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function riskForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.QualityRiskForbidden,
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

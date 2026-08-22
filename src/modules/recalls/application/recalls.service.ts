import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { recallAccessWhere } from '../../authorization/application/record-access.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  CancelRecallDto,
  CloseRecallDto,
  CompleteRecallAssessmentDto,
  CreateRecallDto,
  DecideRecallDto,
  RecallListQueryDto,
  RecordRecallExecutionUpdateDto,
} from './dto/recall-request.dto.js';
import type {
  RecallDetailResponseDto,
  RecallParticipantResponseDto,
  RecallReferencesResponseDto,
  RecallSummaryResponseDto,
} from './dto/recall-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const recallInclude = {
  reportedBy: { select: userSummary },
  approver: { select: userSummary },
  cancelledBy: { select: userSummary },
  sourceComplaint: {
    select: {
      id: true,
      code: true,
      title: true,
      productName: true,
      productCode: true,
      lotNumber: true,
    },
  },
  riskAssessment: { include: { assessedBy: { select: userSummary } } },
  decision: { include: { decidedBy: { select: userSummary } } },
  executionUpdates: {
    include: { recordedBy: { select: userSummary } },
    orderBy: { sequenceNumber: 'asc' as const },
  },
  closure: { include: { closedBy: { select: userSummary } } },
} satisfies Prisma.ProductRecallInclude;

type RecallRecord = Prisma.ProductRecallGetPayload<{
  include: typeof recallInclude;
}>;

const recallPermissions = [
  'recalls.read',
  'recalls.create',
  'recalls.assess',
  'recalls.approve',
  'recalls.execute',
  'recalls.close',
  'recalls.cancel',
];

interface ReconciliationCounters {
  notifiedAccounts: number;
  respondingAccounts: number;
  recoveredUnits: number;
  destroyedUnits: number;
}

@Injectable()
export class RecallsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  listParticipants(
    principal: AuthenticatedPrincipal,
  ): Promise<RecallParticipantResponseDto[]> {
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
            ? recallPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('recalls.'));
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
  ): Promise<RecallReferencesResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => ({
        complaints: await transaction.productComplaint.findMany({
          where: {
            tenantId: principal.tenantId,
            status: 'CLOSED',
            decision: { is: { recallActionRequired: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            code: true,
            title: true,
            productName: true,
            productCode: true,
            lotNumber: true,
          },
        }),
      }),
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: RecallListQueryDto,
  ): Promise<RecallSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const recalls = await transaction.productRecall.findMany({
          where: {
            tenantId: principal.tenantId,
            AND: [recallAccessWhere(principal)],
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
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
                      sourceReference: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: recallInclude,
        });
        const now = new Date();
        return recalls.map((recall) => mapSummary(recall, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    recallId: string,
  ): Promise<RecallDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readRecall(
            transaction,
            principal.tenantId,
            recallId,
            recallAccessWhere(principal),
          ),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateRecallDto,
    request: RequestMetadata,
  ): Promise<RecallDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const targetCloseAt = new Date(input.targetCloseAt);
        const distributionStartDate = input.distributionStartDate
          ? new Date(input.distributionStartDate)
          : null;
        const distributionEndDate = input.distributionEndDate
          ? new Date(input.distributionEndDate)
          : null;
        if (
          targetCloseAt.getTime() <= now.getTime() ||
          (distributionStartDate &&
            distributionEndDate &&
            distributionEndDate < distributionStartDate)
        ) {
          throw recallInvalid(
            'A future target date and a valid distribution period are required.',
          );
        }
        if (input.sourceComplaintId) {
          const complaint = await transaction.productComplaint.findFirst({
            where: {
              id: input.sourceComplaintId,
              tenantId: principal.tenantId,
              status: 'CLOSED',
              decision: { is: { recallActionRequired: true } },
            },
            select: { id: true },
          });
          if (!complaint) {
            throw recallInvalid(
              'The linked complaint must have a signed decision requiring recall action.',
            );
          }
        }
        const sequence = await transaction.recallSequence.upsert({
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
        const code = `RCL-${now.getUTCFullYear()}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.productRecall.create({
          data: {
            tenantId: principal.tenantId,
            code,
            title: input.title,
            actionType: input.actionType,
            sourceComplaintId: input.sourceComplaintId,
            sourceReference: input.sourceReference,
            productName: input.productName,
            productCode: input.productCode,
            lotNumbers: uniqueValues(input.lotNumbers),
            countryCodes: uniqueValues(input.countryCodes),
            reason: input.reason,
            distributionStartDate,
            distributionEndDate,
            totalDistributedUnits: input.totalDistributedUnits,
            targetCloseAt,
            reportedByUserId: principal.userId,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'RECALL_REPORTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            recallId: created.id,
            code,
            actionType: input.actionType,
            productCode: input.productCode,
            lotNumbers: uniqueValues(input.lotNumbers).join(', '),
          },
        });
        return mapDetail(
          await readRecall(transaction, principal.tenantId, created.id),
        );
      },
    );
  }

  async assess(
    principal: AuthenticatedPrincipal,
    recallId: string,
    input: CompleteRecallAssessmentDto,
    request: RequestMetadata,
  ): Promise<RecallDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'RECALL_ASSESSMENT_REAUTHENTICATION_FAILED',
      { recallId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const recall = await readRecall(
          transaction,
          principal.tenantId,
          recallId,
        );
        if (
          recall.status !== 'REPORTED' ||
          recall.riskAssessment ||
          input.approverUserId === principal.userId
        ) {
          throw recallConflict();
        }
        await assertEligibleUser(
          transaction,
          principal.tenantId,
          input.approverUserId,
          'recalls.approve',
          'independent approver',
        );
        const record = {
          recallId,
          classification: input.classification,
          depth: input.depth,
          healthHazard: input.healthHazard,
          scopeRationale: input.scopeRationale,
          regulatoryReportingRequired: input.regulatoryReportingRequired,
          communicationPlan: input.communicationPlan,
          recommendedAction: input.recommendedAction,
          approverUserId: input.approverUserId,
          assessedByUserId: principal.userId,
          assessmentSessionId: principal.sessionId,
          meaning: 'RISK_ASSESSMENT',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          assessedAt: now.toISOString(),
        };
        await transaction.recallRiskAssessment.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            recallId,
            classification: input.classification,
            depth: input.depth,
            healthHazard: input.healthHazard,
            scopeRationale: input.scopeRationale,
            regulatoryReportingRequired: input.regulatoryReportingRequired,
            communicationPlan: input.communicationPlan,
            recommendedAction: input.recommendedAction,
            assessedByUserId: principal.userId,
            assessmentSessionId: principal.sessionId,
            assessedAt: now,
            recordHash: hashRecord(record),
          },
        });
        const changed = await transaction.productRecall.updateMany({
          where: {
            id: recallId,
            tenantId: principal.tenantId,
            status: 'REPORTED',
          },
          data: {
            status: 'PENDING_APPROVAL',
            approverUserId: input.approverUserId,
          },
        });
        if (changed.count !== 1) throw recallConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.approverUserId,
          eventType: 'RECALL_RISK_ASSESSMENT_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            recallId,
            classification: input.classification,
            depth: input.depth,
            regulatoryReportingRequired: input.regulatoryReportingRequired,
          },
        });
        return mapDetail(
          await readRecall(transaction, principal.tenantId, recallId),
        );
      },
    );
  }

  async decide(
    principal: AuthenticatedPrincipal,
    recallId: string,
    input: DecideRecallDto,
    request: RequestMetadata,
  ): Promise<RecallDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'RECALL_DECISION_REAUTHENTICATION_FAILED',
      { recallId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const recall = await readRecall(
          transaction,
          principal.tenantId,
          recallId,
        );
        if (
          recall.status !== 'PENDING_APPROVAL' ||
          recall.decision ||
          recall.approverUserId !== principal.userId ||
          recall.riskAssessment?.assessedByUserId === principal.userId
        ) {
          throw recallForbidden(
            'Only the independent assigned approver may sign this decision.',
          );
        }
        const record = {
          recallId,
          approved: input.approved,
          rationale: input.rationale,
          authorityReference: input.authorityReference,
          decidedByUserId: principal.userId,
          decisionSessionId: principal.sessionId,
          meaning: 'ACTION_DECISION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          decidedAt: now.toISOString(),
        };
        await transaction.recallDecision.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            recallId,
            approved: input.approved,
            rationale: input.rationale,
            authorityReference: input.authorityReference,
            decidedByUserId: principal.userId,
            decisionSessionId: principal.sessionId,
            decidedAt: now,
            recordHash: hashRecord(record),
          },
        });
        const nextStatus = input.approved ? 'APPROVED' : 'REJECTED';
        const changed = await transaction.productRecall.updateMany({
          where: {
            id: recallId,
            tenantId: principal.tenantId,
            status: 'PENDING_APPROVAL',
            approverUserId: principal.userId,
          },
          data: { status: nextStatus },
        });
        if (changed.count !== 1) throw recallConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'RECALL_DECIDED',
          outcome: 'SUCCESS',
          request,
          metadata: { recallId, approved: input.approved },
        });
        return mapDetail(
          await readRecall(transaction, principal.tenantId, recallId),
        );
      },
    );
  }

  recordExecutionUpdate(
    principal: AuthenticatedPrincipal,
    recallId: string,
    input: RecordRecallExecutionUpdateDto,
    request: RequestMetadata,
  ): Promise<RecallDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const recall = await readRecall(
          transaction,
          principal.tenantId,
          recallId,
        );
        if (!['APPROVED', 'IN_EXECUTION'].includes(recall.status)) {
          throw recallConflict();
        }
        const previous = latestCounters(recall);
        const next = executionInputCounters(input);
        assertReconciledCounters(next, previous, recall.totalDistributedUnits);
        const sequenceNumber = recall.executionUpdates.length + 1;
        await transaction.recallExecutionUpdate.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            recallId,
            sequenceNumber,
            updateType: input.updateType,
            note: input.note,
            evidenceReference: input.evidenceReference,
            cumulativeNotifiedAccounts: input.cumulativeNotifiedAccounts,
            cumulativeRespondingAccounts: input.cumulativeRespondingAccounts,
            cumulativeRecoveredUnits: input.cumulativeRecoveredUnits,
            cumulativeDestroyedUnits: input.cumulativeDestroyedUnits,
            recordedByUserId: principal.userId,
            recordedAt: new Date(),
          },
        });
        if (recall.status === 'APPROVED') {
          const changed = await transaction.productRecall.updateMany({
            where: {
              id: recallId,
              tenantId: principal.tenantId,
              status: 'APPROVED',
            },
            data: { status: 'IN_EXECUTION' },
          });
          if (changed.count !== 1) throw recallConflict();
        }
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'RECALL_EXECUTION_UPDATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            recallId,
            sequenceNumber,
            updateType: input.updateType,
            recoveredUnits: input.cumulativeRecoveredUnits,
          },
        });
        return mapDetail(
          await readRecall(transaction, principal.tenantId, recallId),
        );
      },
    );
  }

  async close(
    principal: AuthenticatedPrincipal,
    recallId: string,
    input: CloseRecallDto,
    request: RequestMetadata,
  ): Promise<RecallDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'RECALL_CLOSURE_REAUTHENTICATION_FAILED',
      { recallId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const recall = await readRecall(
          transaction,
          principal.tenantId,
          recallId,
        );
        if (
          recall.status !== 'IN_EXECUTION' ||
          recall.closure ||
          recall.approverUserId !== principal.userId ||
          !recall.decision?.approved
        ) {
          throw recallForbidden(
            'Only the independent assigned approver may sign reconciliation and closure.',
          );
        }
        const finalCounters = closureInputCounters(input);
        assertReconciledCounters(
          finalCounters,
          latestCounters(recall),
          recall.totalDistributedUnits,
        );
        const record = {
          recallId,
          effectivenessSummary: input.effectivenessSummary,
          reconciliationSummary: input.reconciliationSummary,
          ...finalCounters,
          dispositionEvidence: input.dispositionEvidence,
          regulatoryClosureReference: input.regulatoryClosureReference,
          closedByUserId: principal.userId,
          closureSessionId: principal.sessionId,
          meaning: 'RECONCILIATION_CLOSURE',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          closedAt: now.toISOString(),
        };
        await transaction.recallClosure.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            recallId,
            effectivenessSummary: input.effectivenessSummary,
            reconciliationSummary: input.reconciliationSummary,
            finalNotifiedAccounts: input.finalNotifiedAccounts,
            finalRespondingAccounts: input.finalRespondingAccounts,
            finalRecoveredUnits: input.finalRecoveredUnits,
            finalDestroyedUnits: input.finalDestroyedUnits,
            dispositionEvidence: input.dispositionEvidence,
            regulatoryClosureReference: input.regulatoryClosureReference,
            closedByUserId: principal.userId,
            closureSessionId: principal.sessionId,
            closedAt: now,
            recordHash: hashRecord(record),
          },
        });
        const changed = await transaction.productRecall.updateMany({
          where: {
            id: recallId,
            tenantId: principal.tenantId,
            status: 'IN_EXECUTION',
            approverUserId: principal.userId,
          },
          data: { status: 'CLOSED' },
        });
        if (changed.count !== 1) throw recallConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'RECALL_CLOSED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            recallId,
            recoveredUnits: input.finalRecoveredUnits,
            destroyedUnits: input.finalDestroyedUnits,
          },
        });
        return mapDetail(
          await readRecall(transaction, principal.tenantId, recallId),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    recallId: string,
    input: CancelRecallDto,
    request: RequestMetadata,
  ): Promise<RecallDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const recall = await readRecall(
          transaction,
          principal.tenantId,
          recallId,
        );
        if (recall.status !== 'REPORTED') throw recallConflict();
        const changed = await transaction.productRecall.updateMany({
          where: {
            id: recallId,
            tenantId: principal.tenantId,
            status: 'REPORTED',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancellationReason: input.reason,
            cancelledAt: new Date(),
          },
        });
        if (changed.count !== 1) throw recallConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'RECALL_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: { recallId, reason: input.reason },
        });
        return mapDetail(
          await readRecall(transaction, principal.tenantId, recallId),
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

async function readRecall(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  recallId: string,
  accessWhere: Prisma.ProductRecallWhereInput = {},
): Promise<RecallRecord> {
  const recall = await transaction.productRecall.findFirst({
    where: { id: recallId, tenantId, AND: [accessWhere] },
    include: recallInclude,
  });
  if (!recall) throw recallNotFound();
  return recall;
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
    throw recallInvalid(
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

function latestCounters(recall: RecallRecord): ReconciliationCounters {
  const latest = recall.executionUpdates.at(-1);
  if (!latest) {
    return {
      notifiedAccounts: 0,
      respondingAccounts: 0,
      recoveredUnits: 0,
      destroyedUnits: 0,
    };
  }
  return {
    notifiedAccounts: latest.cumulativeNotifiedAccounts,
    respondingAccounts: latest.cumulativeRespondingAccounts,
    recoveredUnits: latest.cumulativeRecoveredUnits,
    destroyedUnits: latest.cumulativeDestroyedUnits,
  };
}

function executionInputCounters(
  input: RecordRecallExecutionUpdateDto,
): ReconciliationCounters {
  return {
    notifiedAccounts: input.cumulativeNotifiedAccounts,
    respondingAccounts: input.cumulativeRespondingAccounts,
    recoveredUnits: input.cumulativeRecoveredUnits,
    destroyedUnits: input.cumulativeDestroyedUnits,
  };
}

function closureInputCounters(input: CloseRecallDto): ReconciliationCounters {
  return {
    notifiedAccounts: input.finalNotifiedAccounts,
    respondingAccounts: input.finalRespondingAccounts,
    recoveredUnits: input.finalRecoveredUnits,
    destroyedUnits: input.finalDestroyedUnits,
  };
}

function assertReconciledCounters(
  next: ReconciliationCounters,
  previous: ReconciliationCounters,
  distributedUnits: number,
): void {
  if (
    next.notifiedAccounts < previous.notifiedAccounts ||
    next.respondingAccounts < previous.respondingAccounts ||
    next.recoveredUnits < previous.recoveredUnits ||
    next.destroyedUnits < previous.destroyedUnits ||
    next.respondingAccounts > next.notifiedAccounts ||
    next.destroyedUnits > next.recoveredUnits ||
    next.recoveredUnits > distributedUnits
  ) {
    throw recallInvalid(
      'Execution counters must be monotonic and reconcilable with distributed units.',
    );
  }
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function mapSummary(
  recall: RecallRecord,
  now = new Date(),
): RecallSummaryResponseDto {
  const counters = recall.closure
    ? {
        recoveredUnits: recall.closure.finalRecoveredUnits,
      }
    : latestCounters(recall);
  const recoveredUnits = counters.recoveredUnits;
  return {
    id: recall.id,
    code: recall.code,
    title: recall.title,
    actionType: recall.actionType,
    productName: recall.productName,
    productCode: recall.productCode,
    lotNumbers: recall.lotNumbers,
    countryCodes: recall.countryCodes,
    status: recall.status,
    dueState: dueState(recall, now),
    targetCloseAt: recall.targetCloseAt.toISOString(),
    classification: recall.riskAssessment?.classification ?? null,
    approver: recall.approver,
    totalDistributedUnits: recall.totalDistributedUnits,
    recoveredUnits,
    recoveryRate: Number(
      ((recoveredUnits / recall.totalDistributedUnits) * 100).toFixed(1),
    ),
    createdAt: recall.createdAt.toISOString(),
  };
}

function mapDetail(recall: RecallRecord): RecallDetailResponseDto {
  const assessment = recall.riskAssessment;
  const decision = recall.decision;
  const closure = recall.closure;
  return {
    ...mapSummary(recall),
    sourceReference: recall.sourceReference,
    sourceComplaint: recall.sourceComplaint,
    reason: recall.reason,
    distributionStartDate:
      recall.distributionStartDate?.toISOString().slice(0, 10) ?? null,
    distributionEndDate:
      recall.distributionEndDate?.toISOString().slice(0, 10) ?? null,
    reportedBy: recall.reportedBy,
    riskAssessment: assessment
      ? {
          id: assessment.id,
          classification: assessment.classification,
          depth: assessment.depth,
          healthHazard: assessment.healthHazard,
          scopeRationale: assessment.scopeRationale,
          regulatoryReportingRequired: assessment.regulatoryReportingRequired,
          communicationPlan: assessment.communicationPlan,
          recommendedAction: assessment.recommendedAction,
          assessedBy: assessment.assessedBy,
          meaning: assessment.meaning,
          authenticationMethod: assessment.authenticationMethod,
          assessedAt: assessment.assessedAt.toISOString(),
          recordHash: assessment.recordHash,
        }
      : null,
    decision: decision
      ? {
          id: decision.id,
          approved: decision.approved,
          rationale: decision.rationale,
          authorityReference: decision.authorityReference,
          decidedBy: decision.decidedBy,
          meaning: decision.meaning,
          authenticationMethod: decision.authenticationMethod,
          decidedAt: decision.decidedAt.toISOString(),
          recordHash: decision.recordHash,
        }
      : null,
    executionUpdates: recall.executionUpdates.map((update) => ({
      id: update.id,
      sequenceNumber: update.sequenceNumber,
      updateType: update.updateType,
      note: update.note,
      evidenceReference: update.evidenceReference,
      cumulativeNotifiedAccounts: update.cumulativeNotifiedAccounts,
      cumulativeRespondingAccounts: update.cumulativeRespondingAccounts,
      cumulativeRecoveredUnits: update.cumulativeRecoveredUnits,
      cumulativeDestroyedUnits: update.cumulativeDestroyedUnits,
      recordedBy: update.recordedBy,
      recordedAt: update.recordedAt.toISOString(),
    })),
    closure: closure
      ? {
          id: closure.id,
          effectivenessSummary: closure.effectivenessSummary,
          reconciliationSummary: closure.reconciliationSummary,
          finalNotifiedAccounts: closure.finalNotifiedAccounts,
          finalRespondingAccounts: closure.finalRespondingAccounts,
          finalRecoveredUnits: closure.finalRecoveredUnits,
          finalDestroyedUnits: closure.finalDestroyedUnits,
          dispositionEvidence: closure.dispositionEvidence,
          regulatoryClosureReference: closure.regulatoryClosureReference,
          closedBy: closure.closedBy,
          meaning: closure.meaning,
          authenticationMethod: closure.authenticationMethod,
          closedAt: closure.closedAt.toISOString(),
          recordHash: closure.recordHash,
        }
      : null,
    cancellationReason: recall.cancellationReason,
    cancelledAt: recall.cancelledAt?.toISOString() ?? null,
  };
}

function dueState(recall: RecallRecord, now: Date): string {
  if (recall.status === 'CLOSED') return 'COMPLETED';
  if (recall.status === 'REJECTED') return 'REJECTED';
  if (recall.status === 'CANCELLED') return 'CANCELLED';
  if (recall.targetCloseAt.getTime() < now.getTime()) return 'OVERDUE';
  return recall.targetCloseAt.getTime() <=
    now.getTime() + 7 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function recallNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.RecallNotFound,
    'The product recall or field action was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function recallInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.RecallInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function recallConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.RecallConflict,
    'The field action changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function recallForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.RecallForbidden,
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

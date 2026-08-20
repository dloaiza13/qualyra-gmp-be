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
  CancelComplaintDto,
  ComplaintListQueryDto,
  CompleteComplaintInvestigationDto,
  CreateComplaintDto,
  DecideComplaintDto,
  TriageComplaintDto,
} from './dto/complaint-request.dto.js';
import type {
  ComplaintDetailResponseDto,
  ComplaintParticipantResponseDto,
  ComplaintReferencesResponseDto,
  ComplaintSummaryResponseDto,
} from './dto/complaint-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const complaintInclude = {
  reportedBy: { select: userSummary },
  investigator: { select: userSummary },
  reviewer: { select: userSummary },
  triagedBy: { select: userSummary },
  cancelledBy: { select: userSummary },
  investigation: {
    include: {
      investigatedBy: { select: userSummary },
      deviation: { select: { id: true, code: true, title: true } },
      capa: { select: { id: true, code: true, title: true } },
      supplier: { select: { id: true, code: true, legalName: true } },
      qualityRisk: { select: { id: true, code: true, title: true } },
      changeControl: { select: { id: true, code: true, title: true } },
    },
  },
  decision: { include: { decidedBy: { select: userSummary } } },
} satisfies Prisma.ProductComplaintInclude;

type ComplaintRecord = Prisma.ProductComplaintGetPayload<{
  include: typeof complaintInclude;
}>;

const complaintPermissions = [
  'complaints.read',
  'complaints.create',
  'complaints.triage',
  'complaints.investigate',
  'complaints.review',
  'complaints.cancel',
];

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  listParticipants(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplaintParticipantResponseDto[]> {
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
            ? complaintPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('complaints.'));
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
  ): Promise<ComplaintReferencesResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const [deviations, capas, suppliers, qualityRisks, changeControls] =
          await Promise.all([
            transaction.deviation.findMany({
              where: { tenantId: principal.tenantId },
              orderBy: { createdAt: 'desc' },
              take: 100,
              select: { id: true, code: true, title: true },
            }),
            transaction.capa.findMany({
              where: { tenantId: principal.tenantId },
              orderBy: { createdAt: 'desc' },
              take: 100,
              select: { id: true, code: true, title: true },
            }),
            transaction.supplier.findMany({
              where: { tenantId: principal.tenantId },
              orderBy: { createdAt: 'desc' },
              take: 100,
              select: { id: true, code: true, legalName: true },
            }),
            transaction.qualityRiskAssessment.findMany({
              where: { tenantId: principal.tenantId },
              orderBy: { createdAt: 'desc' },
              take: 100,
              select: { id: true, code: true, title: true },
            }),
            transaction.changeControl.findMany({
              where: { tenantId: principal.tenantId },
              orderBy: { createdAt: 'desc' },
              take: 100,
              select: { id: true, code: true, title: true },
            }),
          ]);
        return {
          deviations,
          capas,
          suppliers: suppliers.map(({ legalName, ...supplier }) => ({
            ...supplier,
            title: legalName,
          })),
          qualityRisks,
          changeControls,
        };
      },
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: ComplaintListQueryDto,
  ): Promise<ComplaintSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const complaints = await transaction.productComplaint.findMany({
          where: {
            tenantId: principal.tenantId,
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    { productName: { contains: search, mode: 'insensitive' } },
                    { productCode: { contains: search, mode: 'insensitive' } },
                    { lotNumber: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: complaintInclude,
        });
        const now = new Date();
        return complaints.map((complaint) => mapSummary(complaint, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    complaintId: string,
  ): Promise<ComplaintDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readComplaint(transaction, principal.tenantId, complaintId),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateComplaintDto,
    request: RequestMetadata,
  ): Promise<ComplaintDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const receivedAt = new Date(input.receivedAt);
        if (receivedAt.getTime() > now.getTime() + 5 * 60 * 1000) {
          throw complaintInvalid(
            'The complaint received date cannot be in the future.',
          );
        }
        const sequence = await transaction.complaintSequence.upsert({
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
        const code = `PQC-${now.getUTCFullYear()}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.productComplaint.create({
          data: {
            tenantId: principal.tenantId,
            code,
            title: input.title,
            description: input.description,
            source: input.source,
            category: input.category,
            productName: input.productName,
            productCode: input.productCode,
            lotNumber: input.lotNumber,
            expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
            countryCode: input.countryCode,
            receivedAt,
            reporterName: input.reporterName,
            reporterContact: input.reporterContact,
            evidenceReference: input.evidenceReference,
            potentialSafetyEvent: input.potentialSafetyEvent,
            reportedByUserId: principal.userId,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLAINT_REPORTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            complaintId: created.id,
            code,
            productCode: input.productCode,
            lotNumber: input.lotNumber,
            potentialSafetyEvent: input.potentialSafetyEvent,
          },
        });
        return mapDetail(
          await readComplaint(transaction, principal.tenantId, created.id),
        );
      },
    );
  }

  triage(
    principal: AuthenticatedPrincipal,
    complaintId: string,
    input: TriageComplaintDto,
    request: RequestMetadata,
  ): Promise<ComplaintDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const targetCloseAt = new Date(input.targetCloseAt);
        if (
          input.investigatorUserId === input.reviewerUserId ||
          targetCloseAt.getTime() <= now.getTime()
        ) {
          throw complaintInvalid(
            'Triage requires independent participants and a future target date.',
          );
        }
        const complaint = await readComplaint(
          transaction,
          principal.tenantId,
          complaintId,
        );
        if (complaint.status !== 'REPORTED') throw complaintConflict();
        await Promise.all([
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.investigatorUserId,
            'complaints.investigate',
            'investigator',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.reviewerUserId,
            'complaints.review',
            'independent reviewer',
          ),
        ]);
        const changed = await transaction.productComplaint.updateMany({
          where: {
            id: complaintId,
            tenantId: principal.tenantId,
            status: 'REPORTED',
          },
          data: {
            status: 'UNDER_INVESTIGATION',
            severity: input.severity,
            regulatoryAssessment: input.regulatoryAssessment,
            recallAssessmentRequired: input.recallAssessmentRequired,
            immediateActions: input.immediateActions,
            targetCloseAt,
            investigatorUserId: input.investigatorUserId,
            reviewerUserId: input.reviewerUserId,
            triagedByUserId: principal.userId,
            triagedAt: now,
          },
        });
        if (changed.count !== 1) throw complaintConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.investigatorUserId,
          eventType: 'COMPLAINT_TRIAGED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            complaintId,
            severity: input.severity,
            regulatoryAssessment: input.regulatoryAssessment,
            recallAssessmentRequired: input.recallAssessmentRequired,
            reviewerUserId: input.reviewerUserId,
          },
        });
        return mapDetail(
          await readComplaint(transaction, principal.tenantId, complaintId),
        );
      },
    );
  }

  async completeInvestigation(
    principal: AuthenticatedPrincipal,
    complaintId: string,
    input: CompleteComplaintInvestigationDto,
    request: RequestMetadata,
  ): Promise<ComplaintDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'COMPLAINT_INVESTIGATION_REAUTHENTICATION_FAILED',
      { complaintId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const complaint = await readComplaint(
          transaction,
          principal.tenantId,
          complaintId,
        );
        if (
          complaint.status !== 'UNDER_INVESTIGATION' ||
          complaint.investigatorUserId !== principal.userId ||
          complaint.reviewerUserId === principal.userId ||
          complaint.investigation
        ) {
          throw complaintForbidden(
            'Only the assigned investigator can sign this investigation.',
          );
        }
        await assertReferences(transaction, principal.tenantId, input);
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          complaintId,
          complaintCode: complaint.code,
          investigationSummary: input.investigationSummary,
          rootCause: input.rootCause,
          batchImpact: input.batchImpact,
          distributedProductImpact: input.distributedProductImpact,
          sampleEvaluation: input.sampleEvaluation,
          evidenceReference: input.evidenceReference,
          recommendedDisposition: input.recommendedDisposition,
          responseRecommendation: input.responseRecommendation,
          deviationId: input.deviationId ?? null,
          capaId: input.capaId ?? null,
          supplierId: input.supplierId ?? null,
          qualityRiskId: input.qualityRiskId ?? null,
          changeControlId: input.changeControlId ?? null,
          investigatedByUserId: principal.userId,
          investigationSessionId: principal.sessionId,
          meaning: 'INVESTIGATION_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          investigatedAt: now.toISOString(),
        });
        await transaction.complaintInvestigation.create({
          data: {
            id,
            tenantId: principal.tenantId,
            complaintId,
            investigationSummary: input.investigationSummary,
            rootCause: input.rootCause,
            batchImpact: input.batchImpact,
            distributedProductImpact: input.distributedProductImpact,
            sampleEvaluation: input.sampleEvaluation,
            evidenceReference: input.evidenceReference,
            recommendedDisposition: input.recommendedDisposition,
            responseRecommendation: input.responseRecommendation,
            deviationId: input.deviationId,
            capaId: input.capaId,
            supplierId: input.supplierId,
            qualityRiskId: input.qualityRiskId,
            changeControlId: input.changeControlId,
            investigatedByUserId: principal.userId,
            investigationSessionId: principal.sessionId,
            investigatedAt: now,
            recordHash,
          },
        });
        const changed = await transaction.productComplaint.updateMany({
          where: {
            id: complaintId,
            tenantId: principal.tenantId,
            status: 'UNDER_INVESTIGATION',
          },
          data: { status: 'PENDING_REVIEW' },
        });
        if (changed.count !== 1) throw complaintConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLAINT_INVESTIGATION_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: { complaintId, investigationId: id, recordHash },
        });
        return mapDetail(
          await readComplaint(transaction, principal.tenantId, complaintId),
        );
      },
    );
  }

  async decide(
    principal: AuthenticatedPrincipal,
    complaintId: string,
    input: DecideComplaintDto,
    request: RequestMetadata,
  ): Promise<ComplaintDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'COMPLAINT_DECISION_REAUTHENTICATION_FAILED',
      { complaintId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const complaint = await readComplaint(
          transaction,
          principal.tenantId,
          complaintId,
        );
        if (
          complaint.status !== 'PENDING_REVIEW' ||
          complaint.reviewerUserId !== principal.userId ||
          complaint.investigatorUserId === principal.userId ||
          !complaint.investigation ||
          complaint.decision
        ) {
          throw complaintForbidden(
            'Only the assigned independent reviewer can sign this decision.',
          );
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          complaintId,
          complaintCode: complaint.code,
          sourceRecordHash: complaint.investigation.recordHash,
          disposition: input.disposition,
          rationale: input.rationale,
          finalResponseReference: input.finalResponseReference,
          regulatoryAction: input.regulatoryAction,
          recallActionRequired: input.recallActionRequired,
          decidedByUserId: principal.userId,
          decisionSessionId: principal.sessionId,
          meaning: 'COMPLAINT_DECISION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          decidedAt: now.toISOString(),
        });
        await transaction.complaintDecision.create({
          data: {
            id,
            tenantId: principal.tenantId,
            complaintId,
            disposition: input.disposition,
            rationale: input.rationale,
            finalResponseReference: input.finalResponseReference,
            regulatoryAction: input.regulatoryAction,
            recallActionRequired: input.recallActionRequired,
            decidedByUserId: principal.userId,
            decisionSessionId: principal.sessionId,
            decidedAt: now,
            recordHash,
          },
        });
        const changed = await transaction.productComplaint.updateMany({
          where: {
            id: complaintId,
            tenantId: principal.tenantId,
            status: 'PENDING_REVIEW',
          },
          data: { status: 'CLOSED' },
        });
        if (changed.count !== 1) throw complaintConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLAINT_DECIDED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            complaintId,
            decisionId: id,
            disposition: input.disposition,
            recallActionRequired: input.recallActionRequired,
            recordHash,
          },
        });
        return mapDetail(
          await readComplaint(transaction, principal.tenantId, complaintId),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    complaintId: string,
    input: CancelComplaintDto,
    request: RequestMetadata,
  ): Promise<ComplaintDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await readComplaint(transaction, principal.tenantId, complaintId);
        const now = new Date();
        const changed = await transaction.productComplaint.updateMany({
          where: {
            id: complaintId,
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
        if (changed.count !== 1) throw complaintConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLAINT_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: { complaintId, reason: input.reason },
        });
        return mapDetail(
          await readComplaint(transaction, principal.tenantId, complaintId),
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

async function readComplaint(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  complaintId: string,
): Promise<ComplaintRecord> {
  const complaint = await transaction.productComplaint.findFirst({
    where: { id: complaintId, tenantId },
    include: complaintInclude,
  });
  if (!complaint) throw complaintNotFound();
  return complaint;
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
    throw complaintInvalid(
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

async function assertReferences(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  input: CompleteComplaintInvestigationDto,
): Promise<void> {
  if (
    input.deviationId &&
    !(await transaction.deviation.findFirst({
      where: { id: input.deviationId, tenantId },
      select: { id: true },
    }))
  )
    throw invalidReference();
  if (
    input.capaId &&
    !(await transaction.capa.findFirst({
      where: { id: input.capaId, tenantId },
      select: { id: true },
    }))
  )
    throw invalidReference();
  if (
    input.supplierId &&
    !(await transaction.supplier.findFirst({
      where: { id: input.supplierId, tenantId },
      select: { id: true },
    }))
  )
    throw invalidReference();
  if (
    input.qualityRiskId &&
    !(await transaction.qualityRiskAssessment.findFirst({
      where: { id: input.qualityRiskId, tenantId },
      select: { id: true },
    }))
  )
    throw invalidReference();
  if (
    input.changeControlId &&
    !(await transaction.changeControl.findFirst({
      where: { id: input.changeControlId, tenantId },
      select: { id: true },
    }))
  )
    throw invalidReference();
}

function invalidReference(): ApplicationError {
  return complaintInvalid('A linked quality record was not found.');
}

function mapSummary(
  complaint: ComplaintRecord,
  now = new Date(),
): ComplaintSummaryResponseDto {
  return {
    id: complaint.id,
    code: complaint.code,
    title: complaint.title,
    source: complaint.source,
    category: complaint.category,
    productName: complaint.productName,
    productCode: complaint.productCode,
    lotNumber: complaint.lotNumber,
    status: complaint.status,
    severity: complaint.severity,
    potentialSafetyEvent: complaint.potentialSafetyEvent,
    recallAssessmentRequired: complaint.recallAssessmentRequired,
    dueState: dueState(complaint, now),
    targetCloseAt: complaint.targetCloseAt?.toISOString() ?? null,
    investigator: complaint.investigator,
    reviewer: complaint.reviewer,
    createdAt: complaint.createdAt.toISOString(),
  };
}

function mapDetail(complaint: ComplaintRecord): ComplaintDetailResponseDto {
  const investigation = complaint.investigation;
  const decision = complaint.decision;
  return {
    ...mapSummary(complaint),
    description: complaint.description,
    expiryDate: complaint.expiryDate?.toISOString().slice(0, 10) ?? null,
    countryCode: complaint.countryCode,
    receivedAt: complaint.receivedAt.toISOString(),
    reporterName: complaint.reporterName,
    reporterContact: complaint.reporterContact,
    evidenceReference: complaint.evidenceReference,
    regulatoryAssessment: complaint.regulatoryAssessment,
    immediateActions: complaint.immediateActions,
    reportedBy: complaint.reportedBy,
    triagedBy: complaint.triagedBy,
    triagedAt: complaint.triagedAt?.toISOString() ?? null,
    investigation: investigation
      ? {
          id: investigation.id,
          investigationSummary: investigation.investigationSummary,
          rootCause: investigation.rootCause,
          batchImpact: investigation.batchImpact,
          distributedProductImpact: investigation.distributedProductImpact,
          sampleEvaluation: investigation.sampleEvaluation,
          evidenceReference: investigation.evidenceReference,
          recommendedDisposition: investigation.recommendedDisposition,
          responseRecommendation: investigation.responseRecommendation,
          deviation: investigation.deviation,
          capa: investigation.capa,
          supplier: investigation.supplier
            ? {
                id: investigation.supplier.id,
                code: investigation.supplier.code,
                title: investigation.supplier.legalName,
              }
            : null,
          qualityRisk: investigation.qualityRisk,
          changeControl: investigation.changeControl,
          investigatedBy: investigation.investigatedBy,
          meaning: investigation.meaning,
          authenticationMethod: investigation.authenticationMethod,
          investigatedAt: investigation.investigatedAt.toISOString(),
          recordHash: investigation.recordHash,
        }
      : null,
    decision: decision
      ? {
          id: decision.id,
          disposition: decision.disposition,
          rationale: decision.rationale,
          finalResponseReference: decision.finalResponseReference,
          regulatoryAction: decision.regulatoryAction,
          recallActionRequired: decision.recallActionRequired,
          decidedBy: decision.decidedBy,
          meaning: decision.meaning,
          authenticationMethod: decision.authenticationMethod,
          decidedAt: decision.decidedAt.toISOString(),
          recordHash: decision.recordHash,
        }
      : null,
    cancellationReason: complaint.cancellationReason,
    cancelledAt: complaint.cancelledAt?.toISOString() ?? null,
  };
}

function dueState(complaint: ComplaintRecord, now: Date): string {
  if (complaint.status === 'CLOSED') return 'COMPLETED';
  if (complaint.status === 'CANCELLED') return 'CANCELLED';
  if (!complaint.targetCloseAt) return 'NOT_SCHEDULED';
  if (complaint.targetCloseAt.getTime() < now.getTime()) return 'OVERDUE';
  return complaint.targetCloseAt.getTime() <=
    now.getTime() + 7 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function complaintNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplaintNotFound,
    'The product complaint was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function complaintInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplaintInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function complaintConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplaintConflict,
    'The complaint changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function complaintForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplaintForbidden,
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

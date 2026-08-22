import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PasswordHasher } from '../../../infrastructure/crypto/password-hasher.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { auditAccessWhere } from '../../authorization/application/record-access.policy.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  AddAuditFindingDto,
  AuditListQueryDto,
  CancelAuditDto,
  CloseAuditDto,
  CompleteAuditReportDto,
  CreateAuditDto,
  ReviewFindingResponseDto,
  SubmitFindingResponseDto,
} from './dto/audit-request.dto.js';
import type {
  AuditDetailResponseDto,
  AuditSummaryResponseDto,
} from './dto/audit-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const auditInclude = {
  leadAuditor: { select: userSummary },
  reviewer: { select: userSummary },
  createdBy: { select: userSummary },
  report: { include: { completedByUser: { select: userSummary } } },
  closure: { include: { closedByUser: { select: userSummary } } },
  findings: {
    orderBy: { sequenceNumber: 'asc' as const },
    include: {
      responsibleUser: { select: userSummary },
      responses: {
        orderBy: { attemptNumber: 'asc' as const },
        include: {
          respondedByUser: { select: userSummary },
          reviewedByUser: { select: userSummary },
        },
      },
    },
  },
} satisfies Prisma.GmpAuditInclude;
type AuditRecord = Prisma.GmpAuditGetPayload<{ include: typeof auditInclude }>;

const auditPermissions = [
  'audits.read',
  'audits.plan',
  'audits.execute',
  'audits.respond',
  'audits.review',
  'audits.close',
];

@Injectable()
export class AuditsService {
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
            id: true,
            displayName: true,
            email: true,
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
            ? auditPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('audits.'));
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
    query: AuditListQueryDto,
  ): Promise<AuditSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const records = await transaction.gmpAudit.findMany({
          where: {
            tenantId: principal.tenantId,
            AND: [auditAccessWhere(principal)],
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { title: { contains: search, mode: 'insensitive' } },
                    { scope: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { scheduledStartAt: 'desc' }],
          include: auditInclude,
        });
        const now = new Date();
        return records.map((record) => mapSummary(record, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    auditId: string,
  ): Promise<AuditDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readAudit(
            transaction,
            principal.tenantId,
            auditId,
            auditAccessWhere(principal),
          ),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateAuditDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        const scheduledStartAt = new Date(input.scheduledStartAt);
        const scheduledEndAt = new Date(input.scheduledEndAt);
        if (scheduledStartAt.getTime() < now.getTime() - 5 * 60 * 1000) {
          throw auditInvalid('The scheduled start cannot be in the past.');
        }
        if (scheduledEndAt.getTime() <= scheduledStartAt.getTime()) {
          throw auditInvalid('The scheduled end must be after the start.');
        }
        if (input.leadAuditorUserId === input.reviewerUserId) {
          throw auditInvalid(
            'The lead auditor and independent reviewer must be different.',
          );
        }
        await Promise.all([
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.leadAuditorUserId,
            'audits.execute',
            'lead auditor',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.reviewerUserId,
            'audits.review',
            'reviewer',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.reviewerUserId,
            'audits.close',
            'reviewer',
          ),
        ]);
        const year = now.getUTCFullYear();
        const sequence = await transaction.auditSequence.upsert({
          where: { tenantId_year: { tenantId: principal.tenantId, year } },
          create: { tenantId: principal.tenantId, year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `AUD-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.gmpAudit.create({
          data: {
            tenantId: principal.tenantId,
            code,
            title: input.title,
            type: input.type,
            scope: input.scope,
            objectives: input.objectives,
            criteria: input.criteria,
            scheduledStartAt,
            scheduledEndAt,
            leadAuditorUserId: input.leadAuditorUserId,
            reviewerUserId: input.reviewerUserId,
            createdByUserId: principal.userId,
          },
          include: auditInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.leadAuditorUserId,
          eventType: 'GMP_AUDIT_PLANNED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            auditId: created.id,
            code,
            type: input.type,
            reviewerUserId: input.reviewerUserId,
          },
        });
        return mapDetail(created);
      },
    );
  }

  start(
    principal: AuthenticatedPrincipal,
    auditId: string,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        if (audit.status !== 'PLANNED') throw auditConflict();
        if (audit.leadAuditorUserId !== principal.userId) {
          throw auditForbidden(
            'Only the assigned lead auditor can start this audit.',
          );
        }
        const now = new Date();
        const changed = await transaction.gmpAudit.updateMany({
          where: {
            id: audit.id,
            tenantId: principal.tenantId,
            status: 'PLANNED',
          },
          data: { status: 'IN_PROGRESS', startedAt: now },
        });
        if (changed.count !== 1) throw auditConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'GMP_AUDIT_STARTED',
          outcome: 'SUCCESS',
          request,
          metadata: { auditId: audit.id, code: audit.code },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
        );
      },
    );
  }

  addFinding(
    principal: AuthenticatedPrincipal,
    auditId: string,
    input: AddAuditFindingDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        if (audit.status !== 'IN_PROGRESS') throw auditConflict();
        if (audit.leadAuditorUserId !== principal.userId) {
          throw auditForbidden('Only the lead auditor can record findings.');
        }
        if (input.responsibleUserId === audit.reviewerUserId) {
          throw auditInvalid(
            'The independent reviewer cannot own a finding response.',
          );
        }
        await assertEligibleUser(
          transaction,
          principal.tenantId,
          input.responsibleUserId,
          'audits.respond',
          'finding owner',
        );
        const responseDueAt = new Date(input.responseDueAt);
        if (responseDueAt.getTime() <= Date.now()) {
          throw auditInvalid('The response due date must be in the future.');
        }
        const sequenceNumber = audit.findings.length + 1;
        const code = `${audit.code}-F${String(sequenceNumber).padStart(2, '0')}`;
        await transaction.auditFinding.create({
          data: {
            tenantId: principal.tenantId,
            auditId: audit.id,
            sequenceNumber,
            code,
            classification: input.classification,
            title: input.title,
            description: input.description,
            requirementReference: input.requirementReference,
            responsibleUserId: input.responsibleUserId,
            responseDueAt,
            createdByUserId: principal.userId,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.responsibleUserId,
          eventType: 'GMP_AUDIT_FINDING_RECORDED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            auditId: audit.id,
            code: audit.code,
            findingCode: code,
            classification: input.classification,
          },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
        );
      },
    );
  }

  async completeReport(
    principal: AuthenticatedPrincipal,
    auditId: string,
    input: CompleteAuditReportDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'GMP_AUDIT_REPORT_REAUTHENTICATION_FAILED',
      { auditId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        if (audit.status !== 'IN_PROGRESS') throw auditConflict();
        if (audit.leadAuditorUserId !== principal.userId) {
          throw auditForbidden(
            'Only the lead auditor can complete the report.',
          );
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          auditId: audit.id,
          code: audit.code,
          summary: input.summary,
          conclusion: input.conclusion,
          findingCodes: audit.findings.map(({ code }) => code),
          completedByUserId: principal.userId,
          completionSessionId: principal.sessionId,
          meaning: 'AUDIT_REPORT_COMPLETION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          completedAt: now.toISOString(),
        });
        await transaction.auditReport.create({
          data: {
            id,
            tenantId: principal.tenantId,
            auditId: audit.id,
            summary: input.summary,
            conclusion: input.conclusion,
            completedByUserId: principal.userId,
            completionSessionId: principal.sessionId,
            completedAt: now,
            recordHash,
          },
        });
        const status =
          audit.findings.length > 0 ? 'FOLLOW_UP' : 'READY_FOR_CLOSURE';
        const changed = await transaction.gmpAudit.updateMany({
          where: {
            id: audit.id,
            tenantId: principal.tenantId,
            status: 'IN_PROGRESS',
          },
          data: { status },
        });
        if (changed.count !== 1) throw auditConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'GMP_AUDIT_REPORT_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: { auditId: audit.id, code: audit.code, status, recordHash },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
        );
      },
    );
  }

  async submitResponse(
    principal: AuthenticatedPrincipal,
    auditId: string,
    findingId: string,
    input: SubmitFindingResponseDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'GMP_AUDIT_RESPONSE_REAUTHENTICATION_FAILED',
      { auditId, findingId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        const finding = audit.findings.find(({ id }) => id === findingId);
        if (!finding) throw auditNotFound('The audit finding was not found.');
        if (audit.status !== 'FOLLOW_UP' || finding.status !== 'OPEN')
          throw auditConflict();
        if (finding.responsibleUserId !== principal.userId) {
          throw auditForbidden(
            'Only the assigned responsible user can answer this finding.',
          );
        }
        await assertLinkedRecords(
          transaction,
          principal.tenantId,
          input.capaId,
          input.changeControlId,
        );
        const attemptNumber = finding.responses.length + 1;
        const id = randomUUID();
        const responseRecordHash = hashRecord({
          schemaVersion: 1,
          id,
          auditId: audit.id,
          findingId: finding.id,
          findingCode: finding.code,
          attemptNumber,
          response: input.response,
          rootCause: input.rootCause,
          correction: input.correction,
          correctiveAction: input.correctiveAction,
          evidenceReference: input.evidenceReference,
          capaId: input.capaId ?? null,
          changeControlId: input.changeControlId ?? null,
          respondedByUserId: principal.userId,
          responseSessionId: principal.sessionId,
          meaning: 'FINDING_RESPONSE',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          respondedAt: now.toISOString(),
        });
        await transaction.auditFindingResponse.create({
          data: {
            id,
            tenantId: principal.tenantId,
            findingId: finding.id,
            attemptNumber,
            response: input.response,
            rootCause: input.rootCause,
            correction: input.correction,
            correctiveAction: input.correctiveAction,
            evidenceReference: input.evidenceReference,
            capaId: input.capaId,
            changeControlId: input.changeControlId,
            respondedByUserId: principal.userId,
            responseSessionId: principal.sessionId,
            respondedAt: now,
            responseRecordHash,
          },
        });
        const changed = await transaction.auditFinding.updateMany({
          where: {
            id: finding.id,
            tenantId: principal.tenantId,
            status: 'OPEN',
          },
          data: { status: 'RESPONSE_SUBMITTED' },
        });
        if (changed.count !== 1) throw auditConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'GMP_AUDIT_FINDING_RESPONSE_SUBMITTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            auditId: audit.id,
            findingId: finding.id,
            findingCode: finding.code,
            attemptNumber,
            responseRecordHash,
          },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
        );
      },
    );
  }

  async reviewResponse(
    principal: AuthenticatedPrincipal,
    auditId: string,
    findingId: string,
    responseId: string,
    input: ReviewFindingResponseDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'GMP_AUDIT_RESPONSE_REVIEW_REAUTHENTICATION_FAILED',
      { auditId, findingId, responseId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        const finding = audit.findings.find(({ id }) => id === findingId);
        const response = finding?.responses.find(({ id }) => id === responseId);
        if (!finding || !response)
          throw auditNotFound('The audit response was not found.');
        if (
          audit.status !== 'FOLLOW_UP' ||
          finding.status !== 'RESPONSE_SUBMITTED' ||
          response.decision
        ) {
          throw auditConflict();
        }
        if (audit.reviewerUserId !== principal.userId) {
          throw auditForbidden(
            'Only the assigned independent reviewer can review this response.',
          );
        }
        const reviewRecordHash = hashRecord({
          schemaVersion: 1,
          responseRecordHash: response.responseRecordHash,
          decision: input.decision,
          comment: input.comment,
          reviewedByUserId: principal.userId,
          reviewSessionId: principal.sessionId,
          meaning: 'FINDING_RESPONSE_REVIEW',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          reviewedAt: now.toISOString(),
        });
        const reviewed = await transaction.auditFindingResponse.updateMany({
          where: {
            id: response.id,
            tenantId: principal.tenantId,
            decision: null,
          },
          data: {
            decision: input.decision,
            reviewComment: input.comment,
            reviewedByUserId: principal.userId,
            reviewSessionId: principal.sessionId,
            reviewMeaning: 'FINDING_RESPONSE_REVIEW',
            reviewedAt: now,
            reviewRecordHash,
          },
        });
        if (reviewed.count !== 1) throw auditConflict();
        const findingStatus = input.decision === 'ACCEPT' ? 'CLOSED' : 'OPEN';
        const changed = await transaction.auditFinding.updateMany({
          where: {
            id: finding.id,
            tenantId: principal.tenantId,
            status: 'RESPONSE_SUBMITTED',
          },
          data: { status: findingStatus },
        });
        if (changed.count !== 1) throw auditConflict();
        let auditStatus: string = audit.status;
        if (input.decision === 'ACCEPT') {
          const unresolved = await transaction.auditFinding.count({
            where: {
              tenantId: principal.tenantId,
              auditId: audit.id,
              status: { not: 'CLOSED' },
            },
          });
          if (unresolved === 0) {
            const transitioned = await transaction.gmpAudit.updateMany({
              where: {
                id: audit.id,
                tenantId: principal.tenantId,
                status: 'FOLLOW_UP',
              },
              data: { status: 'READY_FOR_CLOSURE' },
            });
            if (transitioned.count !== 1) throw auditConflict();
            auditStatus = 'READY_FOR_CLOSURE';
          }
        }
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: finding.responsibleUserId,
          eventType: 'GMP_AUDIT_FINDING_RESPONSE_REVIEWED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            auditId: audit.id,
            findingId: finding.id,
            responseId: response.id,
            decision: input.decision,
            auditStatus,
            reviewRecordHash,
          },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
        );
      },
    );
  }

  async close(
    principal: AuthenticatedPrincipal,
    auditId: string,
    input: CloseAuditDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'GMP_AUDIT_CLOSURE_REAUTHENTICATION_FAILED',
      { auditId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        if (
          audit.status !== 'READY_FOR_CLOSURE' ||
          audit.findings.some(({ status }) => status !== 'CLOSED')
        ) {
          throw auditConflict();
        }
        if (audit.reviewerUserId !== principal.userId) {
          throw auditForbidden(
            'Only the assigned independent reviewer can close this audit.',
          );
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          auditId: audit.id,
          code: audit.code,
          reportRecordHash: audit.report?.recordHash,
          findingReviewHashes: audit.findings.flatMap(({ responses }) =>
            responses.map(({ reviewRecordHash }) => reviewRecordHash),
          ),
          conclusion: input.conclusion,
          closedByUserId: principal.userId,
          closureSessionId: principal.sessionId,
          meaning: 'AUDIT_CLOSURE',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          closedAt: now.toISOString(),
        });
        await transaction.auditClosure.create({
          data: {
            id,
            tenantId: principal.tenantId,
            auditId: audit.id,
            conclusion: input.conclusion,
            closedByUserId: principal.userId,
            closureSessionId: principal.sessionId,
            closedAt: now,
            recordHash,
          },
        });
        const changed = await transaction.gmpAudit.updateMany({
          where: {
            id: audit.id,
            tenantId: principal.tenantId,
            status: 'READY_FOR_CLOSURE',
          },
          data: { status: 'CLOSED' },
        });
        if (changed.count !== 1) throw auditConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'GMP_AUDIT_CLOSED',
          outcome: 'SUCCESS',
          request,
          metadata: { auditId: audit.id, code: audit.code, recordHash },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
        );
      },
    );
  }

  cancel(
    principal: AuthenticatedPrincipal,
    auditId: string,
    input: CancelAuditDto,
    request: RequestMetadata,
  ): Promise<AuditDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const audit = await readAudit(transaction, principal.tenantId, auditId);
        if (audit.status !== 'PLANNED') throw auditConflict();
        const now = new Date();
        const changed = await transaction.gmpAudit.updateMany({
          where: {
            id: audit.id,
            tenantId: principal.tenantId,
            status: 'PLANNED',
          },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: principal.userId,
            cancelledAt: now,
            cancellationReason: input.reason,
          },
        });
        if (changed.count !== 1) throw auditConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'GMP_AUDIT_CANCELLED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            auditId: audit.id,
            code: audit.code,
            reason: input.reason,
          },
        });
        return mapDetail(
          await readAudit(transaction, principal.tenantId, audit.id),
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

async function readAudit(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  auditId: string,
  accessWhere: Prisma.GmpAuditWhereInput = {},
): Promise<AuditRecord> {
  const audit = await transaction.gmpAudit.findFirst({
    where: { id: auditId, tenantId, AND: [accessWhere] },
    include: auditInclude,
  });
  if (!audit) throw auditNotFound();
  return audit;
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
  if (!user)
    throw auditInvalid(
      `The ${label} must be active and have the required permission.`,
    );
}

async function assertLinkedRecords(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  capaId?: string,
  changeControlId?: string,
): Promise<void> {
  const [capa, change] = await Promise.all([
    capaId
      ? transaction.capa.findFirst({
          where: { id: capaId, tenantId },
          select: { id: true },
        })
      : Promise.resolve({ id: '' }),
    changeControlId
      ? transaction.changeControl.findFirst({
          where: { id: changeControlId, tenantId },
          select: { id: true },
        })
      : Promise.resolve({ id: '' }),
  ]);
  if ((capaId && !capa) || (changeControlId && !change)) {
    throw auditInvalid(
      'Linked CAPA and change controls must belong to the same organization.',
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
  if (!user || user.passwordHash !== passwordHash || !session)
    throw reauthenticationFailed();
}

function mapSummary(
  record: AuditRecord,
  now = new Date(),
): AuditSummaryResponseDto {
  return {
    id: record.id,
    code: record.code,
    title: record.title,
    type: record.type,
    status: record.status,
    dueState: dueState(record.scheduledEndAt, now, record.status),
    leadAuditor: record.leadAuditor,
    reviewer: record.reviewer,
    scheduledStartAt: record.scheduledStartAt.toISOString(),
    scheduledEndAt: record.scheduledEndAt.toISOString(),
    openFindingCount: record.findings.filter(
      ({ status }) => status !== 'CLOSED',
    ).length,
    findingCount: record.findings.length,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapDetail(record: AuditRecord): AuditDetailResponseDto {
  const now = new Date();
  return {
    ...mapSummary(record, now),
    scope: record.scope,
    objectives: record.objectives,
    criteria: record.criteria,
    createdBy: record.createdBy,
    startedAt: record.startedAt?.toISOString() ?? null,
    findings: record.findings.map((finding) => ({
      id: finding.id,
      code: finding.code,
      sequenceNumber: finding.sequenceNumber,
      classification: finding.classification,
      title: finding.title,
      description: finding.description,
      requirementReference: finding.requirementReference,
      responsible: finding.responsibleUser,
      responseDueAt: finding.responseDueAt.toISOString(),
      status: finding.status,
      dueState: dueState(finding.responseDueAt, now, finding.status),
      responses: finding.responses.map((response) => ({
        id: response.id,
        attemptNumber: response.attemptNumber,
        response: response.response,
        rootCause: response.rootCause,
        correction: response.correction,
        correctiveAction: response.correctiveAction,
        evidenceReference: response.evidenceReference,
        capaId: response.capaId,
        changeControlId: response.changeControlId,
        respondedBy: response.respondedByUser,
        responseMeaning: response.responseMeaning,
        authenticationMethod: response.authenticationMethod,
        respondedAt: response.respondedAt.toISOString(),
        responseRecordHash: response.responseRecordHash,
        decision: response.decision,
        reviewComment: response.reviewComment,
        reviewedBy: response.reviewedByUser,
        reviewedAt: response.reviewedAt?.toISOString() ?? null,
        reviewRecordHash: response.reviewRecordHash,
      })),
    })),
    report: record.report
      ? {
          summary: record.report.summary,
          conclusion: record.report.conclusion,
          completedBy: record.report.completedByUser,
          meaning: record.report.meaning,
          authenticationMethod: record.report.authenticationMethod,
          completedAt: record.report.completedAt.toISOString(),
          recordHash: record.report.recordHash,
        }
      : null,
    closure: record.closure
      ? {
          conclusion: record.closure.conclusion,
          closedBy: record.closure.closedByUser,
          meaning: record.closure.meaning,
          authenticationMethod: record.closure.authenticationMethod,
          closedAt: record.closure.closedAt.toISOString(),
          recordHash: record.closure.recordHash,
        }
      : null,
    cancellationReason: record.cancellationReason,
    cancelledAt: record.cancelledAt?.toISOString() ?? null,
  };
}

function dueState(
  dueAt: Date,
  now: Date,
  status: string,
): 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (['CLOSED', 'CANCELLED'].includes(status)) return 'COMPLETED';
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

function auditNotFound(
  message = 'The GMP audit was not found.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.AuditNotFound,
    message,
    HttpStatus.NOT_FOUND,
  );
}

function auditInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.AuditInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function auditConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.AuditConflict,
    'The audit changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function auditForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.AuditForbidden,
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

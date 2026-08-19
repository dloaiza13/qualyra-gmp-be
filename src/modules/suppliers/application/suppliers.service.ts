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
  CompleteSupplierQualificationDto,
  CreateSupplierDto,
  CreateSupplierScarDto,
  DecideSupplierQualificationDto,
  ReviewSupplierScarResponseDto,
  SubmitSupplierScarResponseDto,
  SupplierListQueryDto,
} from './dto/supplier-request.dto.js';
import type {
  SupplierDetailResponseDto,
  SupplierReferencesResponseDto,
  SupplierSummaryResponseDto,
} from './dto/supplier-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const supplierInclude = {
  qualityOwner: { select: userSummary },
  approver: { select: userSummary },
  createdBy: { select: userSummary },
  qualifications: {
    orderBy: { cycleNumber: 'desc' as const },
    include: {
      evaluatedBy: { select: userSummary },
      qualityRisk: { select: { id: true, code: true, title: true } },
      decision: { include: { decidedBy: { select: userSummary } } },
    },
  },
  scars: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      createdBy: { select: userSummary },
      responses: {
        orderBy: { attemptNumber: 'asc' as const },
        include: {
          respondedBy: { select: userSummary },
          reviewedBy: { select: userSummary },
        },
      },
    },
  },
} satisfies Prisma.SupplierInclude;
type SupplierRecord = Prisma.SupplierGetPayload<{
  include: typeof supplierInclude;
}>;

const supplierPermissions = [
  'suppliers.read',
  'suppliers.create',
  'suppliers.assess',
  'suppliers.approve',
  'suppliers.scar',
  'suppliers.review_scar',
];

@Injectable()
export class SuppliersService {
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
            ? supplierPermissions
            : [
                ...new Set(
                  user.userRoles.flatMap(({ role }) =>
                    role.rolePermissions.map(
                      ({ permission }) => permission.code,
                    ),
                  ),
                ),
              ].filter((code) => code.startsWith('suppliers.'));
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
  ): Promise<SupplierReferencesResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const [qualityRisks, capas, changeControls, audits] = await Promise.all(
          [
            transaction.qualityRiskAssessment.findMany({
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
          ],
        );
        return { qualityRisks, capas, changeControls, audits };
      },
    );
  }

  list(
    principal: AuthenticatedPrincipal,
    query: SupplierListQueryDto,
  ): Promise<SupplierSummaryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const search = query.search?.trim();
        const records = await transaction.supplier.findMany({
          where: {
            tenantId: principal.tenantId,
            status: query.status,
            ...(search
              ? {
                  OR: [
                    { code: { contains: search, mode: 'insensitive' } },
                    { legalName: { contains: search, mode: 'insensitive' } },
                    { tradeName: { contains: search, mode: 'insensitive' } },
                    {
                      registrationNumber: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                }
              : {}),
          },
          take: query.limit,
          orderBy: [{ status: 'asc' }, { legalName: 'asc' }],
          include: supplierInclude,
        });
        const now = new Date();
        return records.map((record) => mapSummary(record, now));
      },
    );
  }

  get(
    principal: AuthenticatedPrincipal,
    supplierId: string,
  ): Promise<SupplierDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) =>
        mapDetail(
          await readSupplier(transaction, principal.tenantId, supplierId),
        ),
    );
  }

  create(
    principal: AuthenticatedPrincipal,
    input: CreateSupplierDto,
    request: RequestMetadata,
  ): Promise<SupplierDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        if (
          input.approverUserId === input.qualityOwnerUserId ||
          input.approverUserId === principal.userId
        ) {
          throw supplierInvalid(
            'The supplier approver must be independent from the quality owner and creator.',
          );
        }
        await Promise.all([
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.qualityOwnerUserId,
            'suppliers.assess',
            'quality owner',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.qualityOwnerUserId,
            'suppliers.scar',
            'quality owner',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.approverUserId,
            'suppliers.approve',
            'independent approver',
          ),
          assertEligibleUser(
            transaction,
            principal.tenantId,
            input.approverUserId,
            'suppliers.review_scar',
            'independent approver',
          ),
        ]);
        const now = new Date();
        const year = now.getUTCFullYear();
        const sequence = await transaction.supplierSequence.upsert({
          where: { tenantId_year: { tenantId: principal.tenantId, year } },
          create: { tenantId: principal.tenantId, year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `SUP-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const created = await transaction.supplier.create({
          data: {
            tenantId: principal.tenantId,
            code,
            legalName: input.legalName,
            tradeName: input.tradeName,
            registrationNumber: input.registrationNumber,
            category: input.category,
            criticality: input.criticality,
            scopeOfSupply: input.scopeOfSupply,
            manufacturingSite: input.manufacturingSite,
            countryCode: input.countryCode.toUpperCase(),
            contactName: input.contactName,
            contactEmail: input.contactEmail.toLowerCase(),
            qualityOwnerUserId: input.qualityOwnerUserId,
            approverUserId: input.approverUserId,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.qualityOwnerUserId,
          eventType: 'SUPPLIER_REGISTERED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            supplierId: created.id,
            code,
            category: input.category,
            criticality: input.criticality,
            approverUserId: input.approverUserId,
          },
        });
        return mapDetail(
          await readSupplier(transaction, principal.tenantId, created.id),
        );
      },
    );
  }

  async qualify(
    principal: AuthenticatedPrincipal,
    supplierId: string,
    input: CompleteSupplierQualificationDto,
    request: RequestMetadata,
  ): Promise<SupplierDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'SUPPLIER_QUALIFICATION_REAUTHENTICATION_FAILED',
      { supplierId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const supplier = await readSupplier(
          transaction,
          principal.tenantId,
          supplierId,
        );
        if (supplier.qualityOwnerUserId !== principal.userId) {
          throw supplierForbidden(
            'Only the assigned quality owner can sign this assessment.',
          );
        }
        if (
          supplier.qualifications.some(
            ({ status }) => status === 'PENDING_DECISION',
          ) ||
          supplier.status === 'DISQUALIFIED'
        ) {
          throw supplierConflict();
        }
        const expectedType = supplier.qualifications.length
          ? undefined
          : 'INITIAL';
        if (
          (expectedType === 'INITIAL' && input.type !== 'INITIAL') ||
          (expectedType === undefined && input.type === 'INITIAL')
        ) {
          throw supplierInvalid(
            'The first assessment must be INITIAL; subsequent assessments must be PERIODIC or EVENT_DRIVEN.',
          );
        }
        if (
          input.recommendation === 'CONDITIONALLY_APPROVE' &&
          !input.conditions
        ) {
          throw supplierInvalid(
            'Conditional approval requires documented conditions.',
          );
        }
        if (input.qualityRiskId) {
          const linkedRisk = await transaction.qualityRiskAssessment.findFirst({
            where: {
              id: input.qualityRiskId,
              tenantId: principal.tenantId,
            },
            select: { id: true },
          });
          if (!linkedRisk) {
            throw supplierInvalid(
              'The linked quality risk must belong to the same organization.',
            );
          }
        }
        const cycleNumber = supplier.qualifications.length + 1;
        const overallScore =
          (input.qualitySystemScore +
            input.complianceScore +
            input.deliveryScore +
            input.serviceScore) *
          5;
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          supplierId: supplier.id,
          supplierCode: supplier.code,
          cycleNumber,
          type: input.type,
          qualitySystemScore: input.qualitySystemScore,
          complianceScore: input.complianceScore,
          deliveryScore: input.deliveryScore,
          serviceScore: input.serviceScore,
          overallScore,
          evidenceSummary: input.evidenceSummary,
          recommendation: input.recommendation,
          conditions: input.conditions ?? null,
          qualityRiskId: input.qualityRiskId ?? null,
          evaluatedByUserId: principal.userId,
          evaluationSessionId: principal.sessionId,
          meaning: 'QUALIFICATION_ASSESSMENT',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          evaluatedAt: now.toISOString(),
        });
        await transaction.supplierQualification.create({
          data: {
            id,
            tenantId: principal.tenantId,
            supplierId: supplier.id,
            cycleNumber,
            type: input.type,
            qualitySystemScore: input.qualitySystemScore,
            complianceScore: input.complianceScore,
            deliveryScore: input.deliveryScore,
            serviceScore: input.serviceScore,
            overallScore,
            evidenceSummary: input.evidenceSummary,
            recommendation: input.recommendation,
            conditions: input.conditions,
            qualityRiskId: input.qualityRiskId,
            evaluatedByUserId: principal.userId,
            evaluationSessionId: principal.sessionId,
            evaluatedAt: now,
            recordHash,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'SUPPLIER_QUALIFICATION_COMPLETED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            supplierId: supplier.id,
            code: supplier.code,
            qualificationId: id,
            cycleNumber,
            overallScore,
            recommendation: input.recommendation,
            recordHash,
          },
        });
        return mapDetail(
          await readSupplier(transaction, principal.tenantId, supplier.id),
        );
      },
    );
  }

  async decideQualification(
    principal: AuthenticatedPrincipal,
    supplierId: string,
    qualificationId: string,
    input: DecideSupplierQualificationDto,
    request: RequestMetadata,
  ): Promise<SupplierDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'SUPPLIER_DECISION_REAUTHENTICATION_FAILED',
      { supplierId, qualificationId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const supplier = await readSupplier(
          transaction,
          principal.tenantId,
          supplierId,
        );
        const qualification = supplier.qualifications.find(
          ({ id }) => id === qualificationId,
        );
        if (!qualification) {
          throw supplierNotFound('The supplier qualification was not found.');
        }
        if (
          qualification.status !== 'PENDING_DECISION' ||
          qualification.decision
        ) {
          throw supplierConflict();
        }
        if (
          supplier.approverUserId !== principal.userId ||
          qualification.evaluatedByUserId === principal.userId
        ) {
          throw supplierForbidden(
            'Only the assigned independent approver can sign this decision.',
          );
        }
        const nextReviewAt = input.nextReviewAt
          ? new Date(input.nextReviewAt)
          : null;
        if (
          input.decision !== 'DISQUALIFY' &&
          (!nextReviewAt || nextReviewAt.getTime() <= now.getTime())
        ) {
          throw supplierInvalid('Approval requires a future next-review date.');
        }
        if (input.decision === 'DISQUALIFY' && nextReviewAt) {
          throw supplierInvalid(
            'A disqualified supplier cannot have a next-review date.',
          );
        }
        const id = randomUUID();
        const recordHash = hashRecord({
          schemaVersion: 1,
          id,
          supplierId: supplier.id,
          qualificationId: qualification.id,
          qualificationRecordHash: qualification.recordHash,
          decision: input.decision,
          rationale: input.rationale,
          nextReviewAt: nextReviewAt?.toISOString() ?? null,
          decidedByUserId: principal.userId,
          decisionSessionId: principal.sessionId,
          meaning: 'QUALIFICATION_DECISION',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          decidedAt: now.toISOString(),
        });
        await transaction.supplierQualificationDecision.create({
          data: {
            id,
            tenantId: principal.tenantId,
            qualificationId: qualification.id,
            decision: input.decision,
            rationale: input.rationale,
            nextReviewAt,
            decidedByUserId: principal.userId,
            decisionSessionId: principal.sessionId,
            decidedAt: now,
            recordHash,
          },
        });
        const completed = await transaction.supplierQualification.updateMany({
          where: {
            id: qualification.id,
            tenantId: principal.tenantId,
            status: 'PENDING_DECISION',
          },
          data: { status: 'COMPLETED' },
        });
        if (completed.count !== 1) throw supplierConflict();
        const status =
          input.decision === 'APPROVE'
            ? 'APPROVED'
            : input.decision === 'CONDITIONALLY_APPROVE'
              ? 'CONDITIONALLY_APPROVED'
              : 'DISQUALIFIED';
        await transaction.supplier.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: supplier.id },
          },
          data: { status, nextReviewAt },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'SUPPLIER_QUALIFICATION_DECIDED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            supplierId: supplier.id,
            code: supplier.code,
            qualificationId: qualification.id,
            decision: input.decision,
            status,
            nextReviewAt: nextReviewAt?.toISOString() ?? null,
            recordHash,
          },
        });
        return mapDetail(
          await readSupplier(transaction, principal.tenantId, supplier.id),
        );
      },
    );
  }

  createScar(
    principal: AuthenticatedPrincipal,
    supplierId: string,
    input: CreateSupplierScarDto,
    request: RequestMetadata,
  ): Promise<SupplierDetailResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const supplier = await readSupplier(
          transaction,
          principal.tenantId,
          supplierId,
        );
        if (supplier.qualityOwnerUserId !== principal.userId) {
          throw supplierForbidden(
            'Only the assigned quality owner can issue a supplier corrective action request.',
          );
        }
        if (!['APPROVED', 'CONDITIONALLY_APPROVED'].includes(supplier.status)) {
          throw supplierConflict();
        }
        const dueAt = new Date(input.dueAt);
        if (dueAt.getTime() <= Date.now()) {
          throw supplierInvalid('The SCAR due date must be in the future.');
        }
        await assertScarLinks(transaction, principal.tenantId, input);
        const year = new Date().getUTCFullYear();
        const sequence = await transaction.supplierScarSequence.upsert({
          where: { tenantId_year: { tenantId: principal.tenantId, year } },
          create: { tenantId: principal.tenantId, year, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        const code = `SCAR-${year}-${String(sequence.lastNumber).padStart(4, '0')}`;
        const scar = await transaction.supplierScar.create({
          data: {
            tenantId: principal.tenantId,
            supplierId: supplier.id,
            code,
            title: input.title,
            description: input.description,
            requirementReference: input.requirementReference,
            severity: input.severity,
            dueAt,
            capaId: input.capaId,
            changeControlId: input.changeControlId,
            auditId: input.auditId,
            createdByUserId: principal.userId,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'SUPPLIER_SCAR_ISSUED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            supplierId: supplier.id,
            scarId: scar.id,
            code,
            severity: input.severity,
          },
        });
        return mapDetail(
          await readSupplier(transaction, principal.tenantId, supplier.id),
        );
      },
    );
  }

  async submitScarResponse(
    principal: AuthenticatedPrincipal,
    supplierId: string,
    scarId: string,
    input: SubmitSupplierScarResponseDto,
    request: RequestMetadata,
  ): Promise<SupplierDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'SUPPLIER_SCAR_RESPONSE_REAUTHENTICATION_FAILED',
      { supplierId, scarId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const supplier = await readSupplier(
          transaction,
          principal.tenantId,
          supplierId,
        );
        const scar = supplier.scars.find(({ id }) => id === scarId);
        if (!scar) throw supplierNotFound('The supplier SCAR was not found.');
        if (
          supplier.qualityOwnerUserId !== principal.userId ||
          scar.status !== 'OPEN'
        ) {
          throw supplierForbidden(
            'Only the assigned quality owner can sign the received supplier response.',
          );
        }
        const attemptNumber = scar.responses.length + 1;
        const id = randomUUID();
        const responseRecordHash = hashRecord({
          schemaVersion: 1,
          id,
          supplierId: supplier.id,
          scarId: scar.id,
          scarCode: scar.code,
          attemptNumber,
          response: input.response,
          rootCause: input.rootCause,
          correction: input.correction,
          correctiveAction: input.correctiveAction,
          evidenceReference: input.evidenceReference,
          respondedByUserId: principal.userId,
          responseSessionId: principal.sessionId,
          responseMeaning: 'SCAR_RESPONSE',
          authenticationMethod: 'PASSWORD_REAUTHENTICATION',
          respondedAt: now.toISOString(),
        });
        await transaction.supplierScarResponse.create({
          data: {
            id,
            tenantId: principal.tenantId,
            scarId: scar.id,
            attemptNumber,
            response: input.response,
            rootCause: input.rootCause,
            correction: input.correction,
            correctiveAction: input.correctiveAction,
            evidenceReference: input.evidenceReference,
            respondedByUserId: principal.userId,
            responseSessionId: principal.sessionId,
            respondedAt: now,
            responseRecordHash,
          },
        });
        const changed = await transaction.supplierScar.updateMany({
          where: {
            id: scar.id,
            tenantId: principal.tenantId,
            status: 'OPEN',
          },
          data: { status: 'RESPONSE_SUBMITTED' },
        });
        if (changed.count !== 1) throw supplierConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'SUPPLIER_SCAR_RESPONSE_SUBMITTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            supplierId: supplier.id,
            scarId: scar.id,
            responseId: id,
            attemptNumber,
            responseRecordHash,
          },
        });
        return mapDetail(
          await readSupplier(transaction, principal.tenantId, supplier.id),
        );
      },
    );
  }

  async reviewScarResponse(
    principal: AuthenticatedPrincipal,
    supplierId: string,
    scarId: string,
    responseId: string,
    input: ReviewSupplierScarResponseDto,
    request: RequestMetadata,
  ): Promise<SupplierDetailResponseDto> {
    const passwordHash = await this.reauthenticate(
      principal,
      input.password,
      request,
      'SUPPLIER_SCAR_REVIEW_REAUTHENTICATION_FAILED',
      { supplierId, scarId, responseId },
    );
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const now = new Date();
        await assertCurrentSigner(transaction, principal, passwordHash, now);
        const supplier = await readSupplier(
          transaction,
          principal.tenantId,
          supplierId,
        );
        const scar = supplier.scars.find(({ id }) => id === scarId);
        const response = scar?.responses.find(({ id }) => id === responseId);
        if (!scar || !response) {
          throw supplierNotFound('The supplier SCAR response was not found.');
        }
        if (
          supplier.approverUserId !== principal.userId ||
          scar.status !== 'RESPONSE_SUBMITTED' ||
          response.decision
        ) {
          throw supplierForbidden(
            'Only the assigned independent approver can review this response.',
          );
        }
        const reviewRecordHash = hashRecord({
          schemaVersion: 1,
          responseId: response.id,
          responseRecordHash: response.responseRecordHash,
          decision: input.decision,
          comment: input.comment,
          reviewedByUserId: principal.userId,
          reviewSessionId: principal.sessionId,
          reviewMeaning: 'SCAR_RESPONSE_REVIEW',
          reviewedAt: now.toISOString(),
        });
        const reviewed = await transaction.supplierScarResponse.updateMany({
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
            reviewMeaning: 'SCAR_RESPONSE_REVIEW',
            reviewedAt: now,
            reviewRecordHash,
          },
        });
        if (reviewed.count !== 1) throw supplierConflict();
        const scarStatus = input.decision === 'ACCEPT' ? 'CLOSED' : 'OPEN';
        const advanced = await transaction.supplierScar.updateMany({
          where: {
            id: scar.id,
            tenantId: principal.tenantId,
            status: 'RESPONSE_SUBMITTED',
          },
          data: { status: scarStatus },
        });
        if (advanced.count !== 1) throw supplierConflict();
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'SUPPLIER_SCAR_RESPONSE_REVIEWED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            supplierId: supplier.id,
            scarId: scar.id,
            responseId: response.id,
            decision: input.decision,
            scarStatus,
            reviewRecordHash,
          },
        });
        return mapDetail(
          await readSupplier(transaction, principal.tenantId, supplier.id),
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

async function readSupplier(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  supplierId: string,
): Promise<SupplierRecord> {
  const supplier = await transaction.supplier.findFirst({
    where: { id: supplierId, tenantId },
    include: supplierInclude,
  });
  if (!supplier) throw supplierNotFound();
  return supplier;
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
    throw supplierInvalid(
      `The ${label} must be active and have the required permission.`,
    );
  }
}

async function assertScarLinks(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  input: Pick<CreateSupplierScarDto, 'capaId' | 'changeControlId' | 'auditId'>,
): Promise<void> {
  const [capa, changeControl, audit] = await Promise.all([
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
    (input.capaId && !capa) ||
    (input.changeControlId && !changeControl) ||
    (input.auditId && !audit)
  ) {
    throw supplierInvalid(
      'Linked SCAR records must belong to the same organization.',
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
  supplier: SupplierRecord,
  now = new Date(),
): SupplierSummaryResponseDto {
  const latest = supplier.qualifications[0];
  return {
    id: supplier.id,
    code: supplier.code,
    legalName: supplier.legalName,
    tradeName: supplier.tradeName,
    category: supplier.category,
    criticality: supplier.criticality,
    status: supplier.status,
    approvedList: ['APPROVED', 'CONDITIONALLY_APPROVED'].includes(
      supplier.status,
    ),
    reviewState: supplier.qualifications.some(
      ({ status }) => status === 'PENDING_DECISION',
    )
      ? 'PENDING_DECISION'
      : dueState(supplier.nextReviewAt, now),
    nextReviewAt: supplier.nextReviewAt?.toISOString() ?? null,
    latestScore: latest?.overallScore ?? null,
    openScarCount: supplier.scars.filter(({ status }) => status !== 'CLOSED')
      .length,
    qualityOwner: supplier.qualityOwner,
    approver: supplier.approver,
    createdAt: supplier.createdAt.toISOString(),
  };
}

function mapDetail(supplier: SupplierRecord): SupplierDetailResponseDto {
  const now = new Date();
  return {
    ...mapSummary(supplier, now),
    registrationNumber: supplier.registrationNumber,
    scopeOfSupply: supplier.scopeOfSupply,
    manufacturingSite: supplier.manufacturingSite,
    countryCode: supplier.countryCode,
    contactName: supplier.contactName,
    contactEmail: supplier.contactEmail,
    createdBy: supplier.createdBy,
    qualifications: supplier.qualifications.map((qualification) => ({
      id: qualification.id,
      cycleNumber: qualification.cycleNumber,
      type: qualification.type,
      status: qualification.status,
      qualitySystemScore: qualification.qualitySystemScore,
      complianceScore: qualification.complianceScore,
      deliveryScore: qualification.deliveryScore,
      serviceScore: qualification.serviceScore,
      overallScore: qualification.overallScore,
      evidenceSummary: qualification.evidenceSummary,
      recommendation: qualification.recommendation,
      conditions: qualification.conditions,
      qualityRisk: qualification.qualityRisk,
      evaluatedBy: qualification.evaluatedBy,
      meaning: qualification.meaning,
      authenticationMethod: qualification.authenticationMethod,
      evaluatedAt: qualification.evaluatedAt.toISOString(),
      recordHash: qualification.recordHash,
      decision: qualification.decision
        ? {
            decision: qualification.decision.decision,
            rationale: qualification.decision.rationale,
            nextReviewAt:
              qualification.decision.nextReviewAt?.toISOString() ?? null,
            decidedBy: qualification.decision.decidedBy,
            meaning: qualification.decision.meaning,
            authenticationMethod: qualification.decision.authenticationMethod,
            decidedAt: qualification.decision.decidedAt.toISOString(),
            recordHash: qualification.decision.recordHash,
          }
        : null,
    })),
    scars: supplier.scars.map((scar) => ({
      id: scar.id,
      code: scar.code,
      title: scar.title,
      description: scar.description,
      requirementReference: scar.requirementReference,
      severity: scar.severity,
      dueAt: scar.dueAt.toISOString(),
      dueState: dueState(
        scar.dueAt,
        now,
        scar.status === 'CLOSED' ? 'COMPLETED' : undefined,
      ),
      capaId: scar.capaId,
      changeControlId: scar.changeControlId,
      auditId: scar.auditId,
      status: scar.status,
      createdBy: scar.createdBy,
      createdAt: scar.createdAt.toISOString(),
      responses: scar.responses.map((response) => ({
        id: response.id,
        attemptNumber: response.attemptNumber,
        response: response.response,
        rootCause: response.rootCause,
        correction: response.correction,
        correctiveAction: response.correctiveAction,
        evidenceReference: response.evidenceReference,
        respondedBy: response.respondedBy,
        responseMeaning: response.responseMeaning,
        authenticationMethod: response.authenticationMethod,
        respondedAt: response.respondedAt.toISOString(),
        responseRecordHash: response.responseRecordHash,
        decision: response.decision,
        reviewComment: response.reviewComment,
        reviewedBy: response.reviewedBy,
        reviewedAt: response.reviewedAt?.toISOString() ?? null,
        reviewRecordHash: response.reviewRecordHash,
      })),
    })),
  };
}

function dueState(
  dueAt: Date | null,
  now: Date,
  terminal?: string,
): 'NOT_SCHEDULED' | 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'COMPLETED' {
  if (terminal === 'COMPLETED') return 'COMPLETED';
  if (!dueAt) return 'NOT_SCHEDULED';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  return dueAt.getTime() <= now.getTime() + 30 * 24 * 60 * 60 * 1000
    ? 'DUE_SOON'
    : 'ON_TRACK';
}

function hashRecord(record: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(record), 'utf8')
    .digest('hex');
}

function supplierNotFound(
  message = 'The supplier was not found.',
): ApplicationError {
  return new ApplicationError(
    ErrorCode.SupplierNotFound,
    message,
    HttpStatus.NOT_FOUND,
  );
}

function supplierInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.SupplierInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function supplierConflict(): ApplicationError {
  return new ApplicationError(
    ErrorCode.SupplierConflict,
    'The supplier record changed and no longer allows this action. Reload and try again.',
    HttpStatus.CONFLICT,
  );
}

function supplierForbidden(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.SupplierForbidden,
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

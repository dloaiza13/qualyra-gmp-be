import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import {
  canTransitionComplianceFinding,
  isClosedComplianceFinding,
} from '../domain/compliance-finding-lifecycle.js';
import { ComplianceEvidenceSourceResolver } from '../domain/compliance-evidence-source.js';
import type {
  ComplianceFindingListQueryDto,
  CreateComplianceControlDto,
  CreateComplianceEvidenceDto,
  CreateComplianceFindingDto,
  CreateComplianceFrameworkDto,
  CreateComplianceRequirementDto,
  UpdateComplianceFindingStatusDto,
} from './dto/compliance-request.dto.js';
import type {
  ComplianceControlResponseDto,
  ComplianceEvidenceResponseDto,
  ComplianceFindingResponseDto,
  ComplianceFrameworkResponseDto,
  ComplianceOverviewResponseDto,
} from './dto/compliance-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const requirementSelect = {
  id: true,
  parentRequirementId: true,
  code: true,
  title: true,
  description: true,
  severity: true,
  weight: true,
  mandatory: true,
  sortOrder: true,
} as const;
const frameworkInclude = {
  requirements: {
    orderBy: [{ sortOrder: 'asc' as const }, { code: 'asc' as const }],
    select: requirementSelect,
  },
} satisfies Prisma.ComplianceFrameworkInclude;
const controlInclude = {
  owner: { select: userSummary },
  requirementMappings: {
    include: { requirement: { select: requirementSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { evidence: true } },
} satisfies Prisma.ComplianceControlInclude;
const findingInclude = {
  framework: { select: { id: true, code: true, name: true, version: true } },
  requirement: { select: { id: true, code: true, title: true } },
  control: { select: { id: true, code: true, name: true } },
  owner: { select: userSummary },
  _count: { select: { evidence: true } },
} satisfies Prisma.ComplianceFindingInclude;
const evidenceInclude = {
  createdBy: { select: userSummary },
} satisfies Prisma.ComplianceEvidenceInclude;

type FrameworkRecord = Prisma.ComplianceFrameworkGetPayload<{
  include: typeof frameworkInclude;
}>;
type ControlRecord = Prisma.ComplianceControlGetPayload<{
  include: typeof controlInclude;
}>;
type FindingRecord = Prisma.ComplianceFindingGetPayload<{
  include: typeof findingInclude;
}>;
type EvidenceRecord = Prisma.ComplianceEvidenceGetPayload<{
  include: typeof evidenceInclude;
}>;

@Injectable()
export class ComplianceService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly evidenceSources: ComplianceEvidenceSourceResolver,
  ) {}

  overview(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceOverviewResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const [
          frameworks,
          requirements,
          controls,
          evidence,
          openFindings,
          criticalFindings,
          majorFindings,
          unmappedRequirements,
        ] = await Promise.all([
          transaction.complianceFramework.count({
            where: { tenantId: principal.tenantId, active: true },
          }),
          transaction.complianceRequirement.count({
            where: { tenantId: principal.tenantId },
          }),
          transaction.complianceControl.count({
            where: { tenantId: principal.tenantId, status: 'ACTIVE' },
          }),
          transaction.complianceEvidence.count({
            where: { tenantId: principal.tenantId },
          }),
          transaction.complianceFinding.count({
            where: {
              tenantId: principal.tenantId,
              status: { in: ['OPEN', 'IN_PROGRESS'] },
            },
          }),
          transaction.complianceFinding.count({
            where: {
              tenantId: principal.tenantId,
              status: { in: ['OPEN', 'IN_PROGRESS'] },
              severity: 'CRITICAL',
            },
          }),
          transaction.complianceFinding.count({
            where: {
              tenantId: principal.tenantId,
              status: { in: ['OPEN', 'IN_PROGRESS'] },
              severity: 'MAJOR',
            },
          }),
          transaction.complianceRequirement.count({
            where: {
              tenantId: principal.tenantId,
              controlMappings: { none: {} },
            },
          }),
        ]);
        return {
          frameworks,
          requirements,
          controls,
          evidence,
          openFindings,
          criticalFindings,
          majorFindings,
          unmappedRequirements,
        };
      },
    );
  }

  listFrameworks(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceFrameworkResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const records = await transaction.complianceFramework.findMany({
          where: { tenantId: principal.tenantId },
          orderBy: [{ active: 'desc' }, { name: 'asc' }, { version: 'desc' }],
          include: frameworkInclude,
        });
        return records.map(mapFramework);
      },
    );
  }

  createFramework(
    principal: AuthenticatedPrincipal,
    input: CreateComplianceFrameworkDto,
    request: RequestMetadata,
  ): Promise<ComplianceFrameworkResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        try {
          const created = await transaction.complianceFramework.create({
            data: {
              tenantId: principal.tenantId,
              code: input.code.toUpperCase(),
              name: input.name,
              version: input.version,
              description: input.description,
              jurisdiction: input.jurisdiction,
              effectiveDate: input.effectiveDate
                ? new Date(input.effectiveDate)
                : undefined,
              active: input.active,
              createdByUserId: principal.userId,
            },
            include: frameworkInclude,
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'COMPLIANCE_FRAMEWORK_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              frameworkId: created.id,
              code: created.code,
              version: created.version,
            },
          });
          return mapFramework(created);
        } catch (error: unknown) {
          if (isUniqueConstraintError(error))
            throw complianceConflict(
              'A framework with this code and version already exists.',
            );
          throw error;
        }
      },
    );
  }

  createRequirement(
    principal: AuthenticatedPrincipal,
    frameworkId: string,
    input: CreateComplianceRequirementDto,
    request: RequestMetadata,
  ): Promise<ComplianceFrameworkResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await requireFramework(transaction, principal.tenantId, frameworkId);
        if (input.parentRequirementId) {
          const parent = await transaction.complianceRequirement.findFirst({
            where: {
              id: input.parentRequirementId,
              tenantId: principal.tenantId,
              frameworkId,
            },
            select: { id: true },
          });
          if (!parent)
            throw complianceInvalid(
              'The parent requirement must belong to the same framework.',
            );
        }
        try {
          const created = await transaction.complianceRequirement.create({
            data: {
              tenantId: principal.tenantId,
              frameworkId,
              parentRequirementId: input.parentRequirementId,
              code: input.code,
              title: input.title,
              description: input.description,
              severity: input.severity,
              weight: input.weight,
              mandatory: input.mandatory,
              sortOrder: input.sortOrder,
              createdByUserId: principal.userId,
            },
            select: { id: true },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'COMPLIANCE_REQUIREMENT_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              frameworkId,
              requirementId: created.id,
              code: input.code,
            },
          });
          return mapFramework(
            await transaction.complianceFramework.findFirstOrThrow({
              where: { id: frameworkId, tenantId: principal.tenantId },
              include: frameworkInclude,
            }),
          );
        } catch (error: unknown) {
          if (isUniqueConstraintError(error))
            throw complianceConflict(
              'A requirement with this code already exists in the framework.',
            );
          throw error;
        }
      },
    );
  }

  listControls(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceControlResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const records = await transaction.complianceControl.findMany({
          where: { tenantId: principal.tenantId },
          orderBy: [{ status: 'asc' }, { category: 'asc' }, { code: 'asc' }],
          include: controlInclude,
        });
        return records.map(mapControl);
      },
    );
  }

  createControl(
    principal: AuthenticatedPrincipal,
    input: CreateComplianceControlDto,
    request: RequestMetadata,
  ): Promise<ComplianceControlResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const requirementIds = [...new Set(input.requirementIds)];
        const requirementCount = await transaction.complianceRequirement.count({
          where: { tenantId: principal.tenantId, id: { in: requirementIds } },
        });
        if (requirementCount !== requirementIds.length)
          throw complianceInvalid(
            'One or more requirements are invalid for this organization.',
          );
        if (input.ownerUserId)
          await requireActiveUser(
            transaction,
            principal.tenantId,
            input.ownerUserId,
          );
        try {
          const created = await transaction.complianceControl.create({
            data: {
              tenantId: principal.tenantId,
              code: input.code.toUpperCase(),
              name: input.name,
              description: input.description,
              category: input.category,
              status: input.status,
              ownerUserId: input.ownerUserId,
              createdByUserId: principal.userId,
              requirementMappings: {
                create: requirementIds.map((requirementId) => ({
                  tenantId: principal.tenantId,
                  requirementId,
                })),
              },
            },
            include: controlInclude,
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            subjectUserId: input.ownerUserId,
            eventType: 'COMPLIANCE_CONTROL_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              controlId: created.id,
              code: created.code,
              requirementIds,
            },
          });
          return mapControl(created);
        } catch (error: unknown) {
          if (isUniqueConstraintError(error))
            throw complianceConflict(
              'A compliance control with this code already exists.',
            );
          throw error;
        }
      },
    );
  }

  listEvidence(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceEvidenceResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const records = await transaction.complianceEvidence.findMany({
          where: { tenantId: principal.tenantId },
          take: 200,
          orderBy: { createdAt: 'desc' },
          include: evidenceInclude,
        });
        return records.map(mapEvidence);
      },
    );
  }

  createEvidence(
    principal: AuthenticatedPrincipal,
    input: CreateComplianceEvidenceDto,
    request: RequestMetadata,
  ): Promise<ComplianceEvidenceResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        if (!input.requirementId && !input.controlId && !input.findingId) {
          throw complianceInvalid(
            'Evidence must be linked to a requirement, control, or finding.',
          );
        }
        await this.assertEvidenceTargets(
          transaction,
          principal.tenantId,
          input,
        );
        if (
          !(await this.evidenceSources.exists(
            transaction,
            principal.tenantId,
            input.sourceEntityType,
            input.sourceEntityId,
          ))
        ) {
          throw complianceInvalid(
            'The evidence source does not exist in this organization.',
          );
        }
        const created = await transaction.complianceEvidence.create({
          data: {
            tenantId: principal.tenantId,
            requirementId: input.requirementId,
            controlId: input.controlId,
            findingId: input.findingId,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId,
            sourceReference: input.sourceReference,
            description: input.description,
            validUntil: input.validUntil
              ? new Date(input.validUntil)
              : undefined,
            createdByUserId: principal.userId,
          },
          include: evidenceInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_EVIDENCE_LINKED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            evidenceId: created.id,
            requirementId: input.requirementId,
            controlId: input.controlId,
            findingId: input.findingId,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId,
          },
        });
        return mapEvidence(created);
      },
    );
  }

  listFindings(
    principal: AuthenticatedPrincipal,
    query: ComplianceFindingListQueryDto,
  ): Promise<ComplianceFindingResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const records = await transaction.complianceFinding.findMany({
          where: {
            tenantId: principal.tenantId,
            severity: query.severity,
            status: query.status,
            frameworkId: query.frameworkId,
            ...(query.category
              ? { category: { equals: query.category, mode: 'insensitive' } }
              : {}),
          },
          take: query.limit,
          orderBy: [
            { status: 'asc' },
            { severity: 'asc' },
            { detectedAt: 'desc' },
          ],
          include: findingInclude,
        });
        return records.map(mapFinding);
      },
    );
  }

  createFinding(
    principal: AuthenticatedPrincipal,
    input: CreateComplianceFindingDto,
    request: RequestMetadata,
  ): Promise<ComplianceFindingResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const requirement = await transaction.complianceRequirement.findFirst({
          where: { id: input.requirementId, tenantId: principal.tenantId },
          select: { id: true, frameworkId: true },
        });
        if (!requirement)
          throw complianceNotFound('Compliance requirement was not found.');
        if (input.controlId) {
          const mapping =
            await transaction.complianceControlRequirement.findUnique({
              where: {
                tenantId_controlId_requirementId: {
                  tenantId: principal.tenantId,
                  controlId: input.controlId,
                  requirementId: input.requirementId,
                },
              },
              select: { controlId: true },
            });
          if (!mapping)
            throw complianceInvalid(
              'The selected control is not mapped to this requirement.',
            );
        }
        if (input.ownerUserId)
          await requireActiveUser(
            transaction,
            principal.tenantId,
            input.ownerUserId,
          );
        if (Boolean(input.sourceEntityType) !== Boolean(input.sourceEntityId)) {
          throw complianceInvalid(
            'Finding source type and source id must be provided together.',
          );
        }
        if (
          input.sourceEntityType &&
          input.sourceEntityId &&
          !(await this.evidenceSources.exists(
            transaction,
            principal.tenantId,
            input.sourceEntityType,
            input.sourceEntityId,
          ))
        ) {
          throw complianceInvalid(
            'The finding source does not exist in this organization.',
          );
        }
        const created = await transaction.complianceFinding.create({
          data: {
            tenantId: principal.tenantId,
            frameworkId: requirement.frameworkId,
            requirementId: requirement.id,
            controlId: input.controlId,
            severity: input.severity,
            category: input.category,
            title: input.title,
            description: input.description,
            detectionSource: input.detectionSource,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId,
            ownerUserId: input.ownerUserId,
            createdByUserId: principal.userId,
            dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          },
          include: findingInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          subjectUserId: input.ownerUserId,
          eventType: 'COMPLIANCE_FINDING_CREATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            findingId: created.id,
            requirementId: requirement.id,
            controlId: input.controlId,
            severity: input.severity,
          },
        });
        return mapFinding(created);
      },
    );
  }

  updateFindingStatus(
    principal: AuthenticatedPrincipal,
    findingId: string,
    input: UpdateComplianceFindingStatusDto,
    request: RequestMetadata,
  ): Promise<ComplianceFindingResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const existing = await transaction.complianceFinding.findFirst({
          where: { id: findingId, tenantId: principal.tenantId },
          select: { id: true, status: true },
        });
        if (!existing)
          throw complianceNotFound('Compliance finding was not found.');
        if (!canTransitionComplianceFinding(existing.status, input.status)) {
          throw complianceConflict(
            `Finding cannot transition from ${existing.status} to ${input.status}.`,
          );
        }
        const closed = isClosedComplianceFinding(input.status);
        if (closed && !input.resolutionNote) {
          throw complianceInvalid(
            'A resolution or accepted-risk rationale is required to close a finding.',
          );
        }
        const updated = await transaction.complianceFinding.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: findingId },
          },
          data: {
            status: input.status,
            resolvedAt: closed ? new Date() : null,
            resolvedByUserId: closed ? principal.userId : null,
            resolutionNote: closed ? input.resolutionNote : null,
          },
          include: findingInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_FINDING_STATUS_CHANGED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            findingId,
            previousStatus: existing.status,
            status: input.status,
            resolutionNote: input.resolutionNote,
          },
        });
        return mapFinding(updated);
      },
    );
  }

  private async assertEvidenceTargets(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    input: Pick<
      CreateComplianceEvidenceDto,
      'requirementId' | 'controlId' | 'findingId'
    >,
  ): Promise<void> {
    const [requirement, control, finding] = await Promise.all([
      input.requirementId
        ? transaction.complianceRequirement.findFirst({
            where: { id: input.requirementId, tenantId },
            select: { id: true },
          })
        : undefined,
      input.controlId
        ? transaction.complianceControl.findFirst({
            where: { id: input.controlId, tenantId },
            select: { id: true },
          })
        : undefined,
      input.findingId
        ? transaction.complianceFinding.findFirst({
            where: { id: input.findingId, tenantId },
            select: { id: true, requirementId: true, controlId: true },
          })
        : undefined,
    ]);
    if (
      (input.requirementId && !requirement) ||
      (input.controlId && !control) ||
      (input.findingId && !finding)
    ) {
      throw complianceNotFound(
        'One or more compliance evidence targets were not found.',
      );
    }
    if (
      finding &&
      input.requirementId &&
      finding.requirementId !== input.requirementId
    ) {
      throw complianceInvalid(
        'The finding and requirement evidence targets are inconsistent.',
      );
    }
    if (finding && input.controlId && finding.controlId !== input.controlId) {
      throw complianceInvalid(
        'The finding and control evidence targets are inconsistent.',
      );
    }
  }
}

async function requireFramework(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  frameworkId: string,
): Promise<void> {
  const framework = await transaction.complianceFramework.findFirst({
    where: { id: frameworkId, tenantId },
    select: { id: true },
  });
  if (!framework)
    throw complianceNotFound('Compliance framework was not found.');
}

async function requireActiveUser(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  const user = await transaction.user.findFirst({
    where: { id: userId, tenantId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!user)
    throw complianceInvalid(
      'The selected owner is not an active user in this organization.',
    );
}

function mapFramework(record: FrameworkRecord): ComplianceFrameworkResponseDto {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    version: record.version,
    description: record.description,
    jurisdiction: record.jurisdiction,
    effectiveDate: record.effectiveDate?.toISOString().slice(0, 10) ?? null,
    active: record.active,
    requirements: record.requirements.map((requirement) => ({
      ...requirement,
      weight: Number(requirement.weight),
    })),
  };
}

function mapControl(record: ControlRecord): ComplianceControlResponseDto {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    description: record.description,
    category: record.category,
    status: record.status,
    owner: record.owner,
    requirements: record.requirementMappings.map(({ requirement }) => ({
      ...requirement,
      weight: Number(requirement.weight),
    })),
    evidenceCount: record._count.evidence,
  };
}

function mapEvidence(record: EvidenceRecord): ComplianceEvidenceResponseDto {
  return {
    id: record.id,
    requirementId: record.requirementId,
    controlId: record.controlId,
    findingId: record.findingId,
    sourceEntityType: record.sourceEntityType,
    sourceEntityId: record.sourceEntityId,
    sourceReference: record.sourceReference,
    description: record.description,
    validUntil: record.validUntil?.toISOString().slice(0, 10) ?? null,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
  };
}

function mapFinding(record: FindingRecord): ComplianceFindingResponseDto {
  return {
    id: record.id,
    severity: record.severity,
    status: record.status,
    category: record.category,
    title: record.title,
    description: record.description,
    detectionSource: record.detectionSource,
    sourceEntityType: record.sourceEntityType,
    sourceEntityId: record.sourceEntityId,
    sourceReference: record.sourceReference,
    ruleId: record.ruleId,
    lastEvaluatedAt: record.lastEvaluatedAt?.toISOString() ?? null,
    framework: record.framework,
    requirement: record.requirement,
    control: record.control,
    owner: record.owner,
    detectedAt: record.detectedAt.toISOString(),
    dueAt: record.dueAt?.toISOString() ?? null,
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    resolutionNote: record.resolutionNote,
    evidenceCount: record._count.evidence,
  };
}

function complianceInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplianceInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function complianceNotFound(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplianceNotFound,
    message,
    HttpStatus.NOT_FOUND,
  );
}

function complianceConflict(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplianceConflict,
    message,
    HttpStatus.CONFLICT,
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

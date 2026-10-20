import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import {
  calculateComplianceReadiness,
  defaultComplianceReadinessPolicy,
  type ComplianceReadinessPolicyValues,
  type ComplianceReadinessRequirementFact,
  type ComplianceReadinessResult,
} from '../domain/compliance-readiness.js';
import type {
  ComplianceSnapshotListQueryDto,
  UpdateComplianceReadinessPolicyDto,
} from './dto/compliance-request.dto.js';
import type {
  ComplianceReadinessPolicyResponseDto,
  ComplianceReadinessResponseDto,
  ComplianceScoreSnapshotResponseDto,
} from './dto/compliance-response.dto.js';
import { lockComplianceTenant } from './compliance-transaction-lock.js';

const userSummary = { id: true, displayName: true, email: true } as const;

@Injectable()
export class ComplianceReadinessService {
  constructor(private readonly tenantUnitOfWork: TenantUnitOfWork) {}

  getReadiness(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceReadinessResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId, true);
        return this.calculate(transaction, principal.tenantId);
      },
    );
  }

  getPolicy(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceReadinessPolicyResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => this.loadPolicy(transaction, principal.tenantId),
    );
  }

  updatePolicy(
    principal: AuthenticatedPrincipal,
    input: UpdateComplianceReadinessPolicyDto,
    request: RequestMetadata,
  ): Promise<ComplianceReadinessPolicyResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        const existing = await transaction.complianceReadinessPolicy.findUnique(
          { where: { tenantId: principal.tenantId } },
        );
        const current = existing
          ? mapPolicy(existing)
          : defaultComplianceReadinessPolicy;
        const next: ComplianceReadinessPolicyValues = {
          ...current,
          ...definedPolicyValues(input),
          frameworkWeights:
            input.frameworkWeights === undefined
              ? current.frameworkWeights
              : validatedWeights(input.frameworkWeights, 'frameworkWeights'),
          categoryWeights:
            input.categoryWeights === undefined
              ? current.categoryWeights
              : validatedWeights(input.categoryWeights, 'categoryWeights'),
          version: current.version + 1,
        };
        validatePolicy(next);
        const saved = await transaction.complianceReadinessPolicy.upsert({
          where: { tenantId: principal.tenantId },
          create: {
            tenantId: principal.tenantId,
            ...policyPersistenceData(next),
            createdByUserId: principal.userId,
            updatedByUserId: principal.userId,
          },
          update: {
            ...policyPersistenceData(next),
            updatedByUserId: principal.userId,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_READINESS_POLICY_UPDATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            previousVersion: existing?.version ?? null,
            version: saved.version,
            previousPolicy: policyPersistenceData(current),
            policy: policyPersistenceData(next),
            criticalPenalty: Number(saved.criticalPenalty),
            majorPenalty: Number(saved.majorPenalty),
            unmappedRequirementPenalty: Number(
              saved.unmappedRequirementPenalty,
            ),
          },
        });
        return mapPolicy(saved);
      },
    );
  }

  listSnapshots(
    principal: AuthenticatedPrincipal,
    query: ComplianceSnapshotListQueryDto,
  ): Promise<ComplianceScoreSnapshotResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const snapshots = await transaction.complianceScoreSnapshot.findMany({
          where: { tenantId: principal.tenantId },
          orderBy: { createdAt: 'desc' },
          take: query.limit,
          include: { createdBy: { select: userSummary } },
        });
        return snapshots.map(mapSnapshot);
      },
    );
  }

  captureSnapshot(
    principal: AuthenticatedPrincipal,
    request: RequestMetadata,
  ): Promise<ComplianceScoreSnapshotResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId, true);
        const readiness = await this.calculate(transaction, principal.tenantId);
        const snapshot = await transaction.complianceScoreSnapshot.create({
          data: {
            tenantId: principal.tenantId,
            overallScore: readiness.overallScore,
            status: readiness.status,
            activeFrameworks: readiness.coverage.activeFrameworks,
            totalRequirements: readiness.coverage.totalRequirements,
            mappedRequirements: readiness.coverage.mappedRequirements,
            evidenceCoveredRequirements:
              readiness.coverage.evidenceCoveredRequirements,
            criticalFindings: readiness.findings.critical,
            majorFindings: readiness.findings.major,
            minorFindings: readiness.findings.minor,
            observationFindings: readiness.findings.observation,
            acceptedRiskFindings: readiness.findings.acceptedRisk,
            policyVersion: readiness.methodology.policy.version,
            calculation: readiness as unknown as Prisma.InputJsonObject,
            createdByUserId: principal.userId,
          },
          include: { createdBy: { select: userSummary } },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_READINESS_SNAPSHOT_CREATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            snapshotId: snapshot.id,
            score: readiness.overallScore,
            status: readiness.status,
            policyVersion: readiness.methodology.policy.version,
          },
        });
        return mapSnapshot(snapshot);
      },
    );
  }

  private async calculate(
    transaction: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<ComplianceReadinessResult> {
    const calculatedAt = new Date();
    // validUntil is a calendar date: evidence remains valid for that whole UTC day.
    const validOnDate = new Date(calculatedAt.toISOString().slice(0, 10));
    const validEvidenceWhere: Prisma.ComplianceEvidenceWhereInput = {
      OR: [{ validUntil: null }, { validUntil: { gte: validOnDate } }],
    };
    const [policy, frameworks, findings] = await Promise.all([
      this.loadPolicy(transaction, tenantId),
      transaction.complianceFramework.findMany({
        where: { tenantId, active: true },
        orderBy: [{ code: 'asc' }, { version: 'desc' }],
        select: {
          id: true,
          code: true,
          name: true,
          version: true,
          requirements: {
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
            select: {
              id: true,
              code: true,
              title: true,
              weight: true,
              mandatory: true,
              evidence: {
                where: validEvidenceWhere,
                select: { id: true },
                take: 1,
              },
              controlMappings: {
                where: { control: { status: 'ACTIVE' } },
                select: {
                  control: {
                    select: {
                      id: true,
                      category: true,
                      evidence: {
                        where: validEvidenceWhere,
                        select: { id: true },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      transaction.complianceFinding.findMany({
        where: {
          tenantId,
          status: { in: ['OPEN', 'IN_PROGRESS', 'ACCEPTED_RISK'] },
          framework: { active: true },
        },
        select: {
          id: true,
          title: true,
          severity: true,
          status: true,
          category: true,
          sourceReference: true,
          requirementId: true,
        },
      }),
    ]);
    const requirements: ComplianceReadinessRequirementFact[] =
      frameworks.flatMap((framework) =>
        framework.requirements.map((requirement) => ({
          id: requirement.id,
          code: requirement.code,
          title: requirement.title,
          weight: Number(requirement.weight),
          mandatory: requirement.mandatory,
          framework: {
            id: framework.id,
            code: framework.code,
            name: framework.name,
            version: framework.version,
          },
          hasDirectValidEvidence: requirement.evidence.length > 0,
          controls: requirement.controlMappings.map(({ control }) => ({
            id: control.id,
            category: control.category,
            hasValidEvidence: control.evidence.length > 0,
          })),
        })),
      );
    const result = calculateComplianceReadiness({
      calculatedAt,
      policy,
      requirements,
      findings,
    });
    return {
      ...result,
      coverage: { ...result.coverage, activeFrameworks: frameworks.length },
    };
  }

  private async loadPolicy(
    transaction: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<ComplianceReadinessPolicyValues> {
    const policy = await transaction.complianceReadinessPolicy.findUnique({
      where: { tenantId },
    });
    return policy ? mapPolicy(policy) : defaultComplianceReadinessPolicy;
  }
}

function definedPolicyValues(
  input: UpdateComplianceReadinessPolicyDto,
): Partial<ComplianceReadinessPolicyValues> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        value !== undefined &&
        key !== 'frameworkWeights' &&
        key !== 'categoryWeights',
    ),
  );
}

function validatedWeights(
  value: Record<string, unknown>,
  field: string,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw complianceInvalid(`${field} must be an object.`);
  }
  const entries = Object.entries(value).map(([rawKey, rawWeight]) => {
    const key = rawKey.trim();
    if (!key || key.length > 200) {
      throw complianceInvalid(`${field} contains an invalid key.`);
    }
    if (
      typeof rawWeight !== 'number' ||
      !Number.isFinite(rawWeight) ||
      rawWeight < 0.1 ||
      rawWeight > 10
    ) {
      throw complianceInvalid(
        `${field}.${key} must be a number between 0.1 and 10.`,
      );
    }
    return [key, rawWeight] as const;
  });
  return Object.fromEntries(entries);
}

function validatePolicy(policy: ComplianceReadinessPolicyValues): void {
  const numericFields = [
    policy.criticalPenalty,
    policy.majorPenalty,
    policy.minorPenalty,
    policy.observationPenalty,
    policy.unmappedRequirementPenalty,
    policy.missingEvidencePenalty,
    policy.excellentMinimum,
    policy.goodMinimum,
    policy.needsAttentionMinimum,
  ];
  if (
    numericFields.some(
      (value) =>
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100,
    )
  ) {
    throw complianceInvalid(
      'Policy penalties and thresholds must be numbers between 0 and 100.',
    );
  }
  if (
    policy.criticalPenalty < policy.majorPenalty ||
    policy.majorPenalty < policy.minorPenalty ||
    policy.minorPenalty < policy.observationPenalty
  ) {
    throw complianceInvalid(
      'Severity penalties must descend from critical to observation.',
    );
  }
  if (
    policy.excellentMinimum <= policy.goodMinimum ||
    policy.goodMinimum <= policy.needsAttentionMinimum
  ) {
    throw complianceInvalid(
      'Readiness thresholds must descend from excellent to needs attention.',
    );
  }
}

function policyPersistenceData(policy: ComplianceReadinessPolicyValues) {
  return {
    criticalPenalty: policy.criticalPenalty,
    majorPenalty: policy.majorPenalty,
    minorPenalty: policy.minorPenalty,
    observationPenalty: policy.observationPenalty,
    unmappedRequirementPenalty: policy.unmappedRequirementPenalty,
    missingEvidencePenalty: policy.missingEvidencePenalty,
    excellentMinimum: policy.excellentMinimum,
    goodMinimum: policy.goodMinimum,
    needsAttentionMinimum: policy.needsAttentionMinimum,
    frameworkWeights: policy.frameworkWeights,
    categoryWeights: policy.categoryWeights,
    version: policy.version,
  };
}

function mapPolicy(
  policy: Prisma.ComplianceReadinessPolicyGetPayload<object>,
): ComplianceReadinessPolicyValues {
  return {
    version: policy.version,
    criticalPenalty: Number(policy.criticalPenalty),
    majorPenalty: Number(policy.majorPenalty),
    minorPenalty: Number(policy.minorPenalty),
    observationPenalty: Number(policy.observationPenalty),
    unmappedRequirementPenalty: Number(policy.unmappedRequirementPenalty),
    missingEvidencePenalty: Number(policy.missingEvidencePenalty),
    excellentMinimum: Number(policy.excellentMinimum),
    goodMinimum: Number(policy.goodMinimum),
    needsAttentionMinimum: Number(policy.needsAttentionMinimum),
    frameworkWeights: storedWeights(policy.frameworkWeights),
    categoryWeights: storedWeights(policy.categoryWeights),
  };
}

function storedWeights(value: Prisma.JsonValue): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

function mapSnapshot(
  snapshot: Prisma.ComplianceScoreSnapshotGetPayload<{
    include: { createdBy: { select: typeof userSummary } };
  }>,
): ComplianceScoreSnapshotResponseDto {
  const calculation =
    snapshot.calculation as unknown as ComplianceReadinessResult;
  return {
    id: snapshot.id,
    overallScore:
      snapshot.overallScore === null ? null : Number(snapshot.overallScore),
    status: snapshot.status,
    activeFrameworks: snapshot.activeFrameworks,
    totalRequirements: snapshot.totalRequirements,
    mappedRequirements: snapshot.mappedRequirements,
    evidenceCoveredRequirements: snapshot.evidenceCoveredRequirements,
    criticalFindings: snapshot.criticalFindings,
    majorFindings: snapshot.majorFindings,
    minorFindings: snapshot.minorFindings,
    observationFindings: snapshot.observationFindings,
    acceptedRiskFindings: snapshot.acceptedRiskFindings,
    policyVersion: snapshot.policyVersion,
    frameworks: calculation.frameworks ?? [],
    categories: calculation.categories ?? [],
    createdBy: snapshot.createdBy,
    createdAt: snapshot.createdAt.toISOString(),
  };
}

function complianceInvalid(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.ComplianceInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

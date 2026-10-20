import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import {
  matchedFindingAction,
  shouldResolveMissingFinding,
} from '../domain/compliance-finding-reconciliation.js';
import { ComplianceRuleRegistry } from './compliance-rule-registry.js';
import { lockComplianceTenant } from './compliance-transaction-lock.js';
import type {
  ComplianceEvaluationListQueryDto,
  CreateComplianceRuleDto,
  RunComplianceEvaluationDto,
  UpdateComplianceRuleDto,
} from './dto/compliance-request.dto.js';
import type {
  ComplianceEvaluationRunResponseDto,
  ComplianceRuleCatalogResponseDto,
  ComplianceRuleResponseDto,
} from './dto/compliance-response.dto.js';

const userSummary = { id: true, displayName: true, email: true } as const;
const ruleInclude = {
  requirement: {
    select: {
      id: true,
      code: true,
      title: true,
      framework: {
        select: {
          id: true,
          code: true,
          name: true,
          version: true,
          active: true,
        },
      },
    },
  },
  control: { select: { id: true, code: true, name: true } },
  owner: { select: userSummary },
} satisfies Prisma.ComplianceRuleInclude;
const runInclude = {
  triggeredBy: { select: userSummary },
  results: {
    orderBy: { startedAt: 'asc' as const },
    include: { rule: { select: { id: true, key: true, name: true } } },
  },
} satisfies Prisma.ComplianceEvaluationRunInclude;

type RuleRecord = Prisma.ComplianceRuleGetPayload<{
  include: typeof ruleInclude;
}>;
type RunRecord = Prisma.ComplianceEvaluationRunGetPayload<{
  include: typeof runInclude;
}>;

@Injectable()
export class ComplianceEvaluationService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly registry: ComplianceRuleRegistry,
  ) {}

  catalog(): ComplianceRuleCatalogResponseDto[] {
    return this.registry.definitions().map((definition) => ({ ...definition }));
  }

  listRules(
    principal: AuthenticatedPrincipal,
  ): Promise<ComplianceRuleResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const rules = await transaction.complianceRule.findMany({
          where: { tenantId: principal.tenantId },
          orderBy: [{ enabled: 'desc' }, { category: 'asc' }, { name: 'asc' }],
          include: ruleInclude,
        });
        return rules.map(mapRule);
      },
    );
  }

  createRule(
    principal: AuthenticatedPrincipal,
    input: CreateComplianceRuleDto,
    request: RequestMetadata,
  ): Promise<ComplianceRuleResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        await assertRuleTargets(
          transaction,
          principal.tenantId,
          input.requirementId,
          input.controlId,
          input.ownerUserId,
        );
        let configuration: Prisma.InputJsonObject;
        try {
          configuration = this.registry.normalizeConfiguration(
            input.implementationKey,
            input.configuration,
          );
        } catch (error) {
          throw invalidConfiguration(error);
        }
        try {
          const created = await transaction.complianceRule.create({
            data: {
              tenantId: principal.tenantId,
              key: input.key,
              name: input.name,
              description: input.description,
              implementationKey: input.implementationKey,
              category: input.category,
              severity: input.severity,
              requirementId: input.requirementId,
              controlId: input.controlId,
              ownerUserId: input.ownerUserId,
              enabled: input.enabled,
              configuration,
              createdByUserId: principal.userId,
            },
            include: ruleInclude,
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'COMPLIANCE_RULE_CREATED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              ruleId: created.id,
              key: created.key,
              implementationKey: created.implementationKey,
              requirementId: created.requirementId,
            },
          });
          return mapRule(created);
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw complianceConflict(
              'A compliance rule with this key already exists.',
            );
          }
          throw error;
        }
      },
    );
  }

  updateRule(
    principal: AuthenticatedPrincipal,
    ruleId: string,
    input: UpdateComplianceRuleDto,
    request: RequestMetadata,
  ): Promise<ComplianceRuleResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        const existing = await transaction.complianceRule.findFirst({
          where: { id: ruleId, tenantId: principal.tenantId },
        });
        if (!existing)
          throw complianceNotFound('Compliance rule was not found.');
        let configuration: Prisma.InputJsonObject | undefined;
        if (input.configuration) {
          if (!this.registry.has(existing.implementationKey)) {
            throw complianceInvalid(
              'The rule implementation is not available in this deployment.',
            );
          }
          try {
            configuration = this.registry.normalizeConfiguration(
              existing.implementationKey,
              input.configuration,
            );
          } catch (error) {
            throw invalidConfiguration(error);
          }
        }
        const updated = await transaction.complianceRule.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: ruleId },
          },
          data: {
            name: input.name,
            description: input.description,
            category: input.category,
            severity: input.severity,
            enabled: input.enabled,
            configuration,
          },
          include: ruleInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_RULE_UPDATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            ruleId,
            previousEnabled: existing.enabled,
            enabled: updated.enabled,
            severity: updated.severity,
            previousConfiguration: existing.configuration,
            configuration: updated.configuration,
            previousSeverity: existing.severity,
            previousCategory: existing.category,
            category: updated.category,
          },
        });
        return mapRule(updated);
      },
    );
  }

  listEvaluations(
    principal: AuthenticatedPrincipal,
    query: ComplianceEvaluationListQueryDto,
  ): Promise<ComplianceEvaluationRunResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const runs = await transaction.complianceEvaluationRun.findMany({
          where: { tenantId: principal.tenantId },
          take: query.limit,
          orderBy: { startedAt: 'desc' },
          include: runInclude,
        });
        return runs.map(mapRun);
      },
    );
  }

  getEvaluation(
    principal: AuthenticatedPrincipal,
    evaluationId: string,
  ): Promise<ComplianceEvaluationRunResponseDto> {
    return this.loadRun(principal.tenantId, evaluationId);
  }

  async evaluate(
    principal: AuthenticatedPrincipal,
    input: RunComplianceEvaluationDto,
    request: RequestMetadata,
  ): Promise<ComplianceEvaluationRunResponseDto> {
    let started: { runId: string; ruleIds: string[]; existing: boolean };
    try {
      started = await this.startEvaluation(principal, input, request);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw complianceConflict(
          'Another compliance evaluation is already running for this organization.',
        );
      }
      throw error;
    }
    if (started.existing) {
      return this.loadRun(principal.tenantId, started.runId);
    }

    for (const ruleId of started.ruleIds) {
      try {
        await this.evaluateRule(principal, started.runId, ruleId, request);
      } catch (error) {
        await this.recordRuleError(
          principal,
          started.runId,
          ruleId,
          error,
          request,
        );
      }
    }

    return this.finalizeEvaluation(principal, started.runId, request);
  }

  private startEvaluation(
    principal: AuthenticatedPrincipal,
    input: RunComplianceEvaluationDto,
    request: RequestMetadata,
  ): Promise<{ runId: string; ruleIds: string[]; existing: boolean }> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        const existing = await transaction.complianceEvaluationRun.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId: principal.tenantId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          select: { id: true },
        });
        if (existing) {
          return { runId: existing.id, ruleIds: [], existing: true };
        }

        const staleBefore = new Date(Date.now() - staleRunMilliseconds);
        await transaction.complianceEvaluationRun.updateMany({
          where: {
            tenantId: principal.tenantId,
            status: 'RUNNING',
            startedAt: { lt: staleBefore },
          },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorSummary:
              'Evaluation interrupted before completion; superseded by a later run.',
          },
        });
        const running = await transaction.complianceEvaluationRun.findFirst({
          where: { tenantId: principal.tenantId, status: 'RUNNING' },
          select: { id: true },
        });
        if (running) {
          throw complianceConflict(
            'Another compliance evaluation is already running for this organization.',
          );
        }

        const requestedIds = [...new Set(input.ruleIds ?? [])];
        const rules = await transaction.complianceRule.findMany({
          where: {
            tenantId: principal.tenantId,
            enabled: true,
            requirement: { framework: { active: true } },
            ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
          },
          orderBy: { key: 'asc' },
          select: { id: true, implementationKey: true },
        });
        if (requestedIds.length && rules.length !== requestedIds.length) {
          throw complianceInvalid(
            'One or more selected rules do not exist, are disabled, or belong to an inactive framework.',
          );
        }
        if (!rules.length) {
          throw complianceInvalid(
            'At least one enabled compliance rule is required for evaluation.',
          );
        }
        const unsupported = rules.find(
          ({ implementationKey }) => !this.registry.has(implementationKey),
        );
        if (unsupported) {
          throw complianceInvalid(
            `Rule implementation ${unsupported.implementationKey} is not available.`,
          );
        }

        const run = await transaction.complianceEvaluationRun.create({
          data: {
            tenantId: principal.tenantId,
            idempotencyKey: input.idempotencyKey,
            triggeredByUserId: principal.userId,
          },
          select: { id: true },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_EVALUATION_STARTED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            evaluationRunId: run.id,
            ruleIds: rules.map(({ id }) => id),
          },
        });
        return {
          runId: run.id,
          ruleIds: rules.map(({ id }) => id),
          existing: false,
        };
      },
    );
  }

  private evaluateRule(
    principal: AuthenticatedPrincipal,
    runId: string,
    ruleId: string,
    request: RequestMetadata,
  ): Promise<void> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        const startedAt = new Date();
        const [run, rule] = await Promise.all([
          transaction.complianceEvaluationRun.findFirst({
            where: {
              id: runId,
              tenantId: principal.tenantId,
              status: 'RUNNING',
            },
            select: { id: true },
          }),
          transaction.complianceRule.findFirst({
            where: {
              id: ruleId,
              tenantId: principal.tenantId,
              enabled: true,
              requirement: { framework: { active: true } },
            },
            select: {
              id: true,
              key: true,
              name: true,
              implementationKey: true,
              category: true,
              severity: true,
              requirementId: true,
              controlId: true,
              ownerUserId: true,
              configuration: true,
              requirement: { select: { frameworkId: true } },
            },
          }),
        ]);
        if (!run)
          throw new Error('Compliance evaluation is no longer running.');
        if (!rule)
          throw new Error('Compliance rule is unavailable or disabled.');
        if (!this.registry.has(rule.implementationKey)) {
          throw new Error(
            `Unsupported compliance rule implementation: ${rule.implementationKey}.`,
          );
        }

        const evaluatedAt = new Date();
        const evaluation = await this.registry
          .get(rule.implementationKey)
          .evaluate({
            transaction,
            tenantId: principal.tenantId,
            evaluatedAt,
            configuration: rule.configuration,
          });
        const existingFindings = await transaction.complianceFinding.findMany({
          where: { tenantId: principal.tenantId, ruleId: rule.id },
          select: { id: true, fingerprint: true, status: true },
        });
        const byFingerprint = new Map(
          existingFindings.flatMap((finding) =>
            finding.fingerprint
              ? [[finding.fingerprint, finding] as const]
              : [],
          ),
        );
        const currentFingerprints = new Set<string>();
        const details: Prisma.InputJsonObject[] = [];
        let findingsCreated = 0;
        let findingsReopened = 0;
        let findingsUnchanged = 0;

        for (const violation of evaluation.violations) {
          const fingerprint = findingFingerprint(rule.id, violation.subjectKey);
          currentFingerprints.add(fingerprint);
          const existing = byFingerprint.get(fingerprint);
          const sharedData = {
            severity: rule.severity,
            category: rule.category,
            title: violation.title,
            description: violation.description,
            detectionSource: `RULE:${rule.key}`,
            sourceEntityType: violation.sourceEntityType,
            sourceEntityId: violation.sourceEntityId,
            sourceReference: violation.sourceReference,
            ownerUserId: violation.ownerUserId ?? rule.ownerUserId,
            dueAt: violation.dueAt,
            lastEvaluationRunId: runId,
            lastEvaluatedAt: evaluatedAt,
          } as const;
          let findingId: string;
          let findingStatus: string;
          const action = matchedFindingAction(existing?.status ?? null);
          if (action === 'CREATE') {
            const created = await transaction.complianceFinding.create({
              data: {
                tenantId: principal.tenantId,
                frameworkId: rule.requirement.frameworkId,
                requirementId: rule.requirementId,
                controlId: rule.controlId,
                ruleId: rule.id,
                fingerprint,
                createdByUserId: principal.userId,
                ...sharedData,
              },
              select: { id: true, status: true },
            });
            findingId = created.id;
            findingStatus = created.status;
            findingsCreated += 1;
            await appendSecurityEvent(transaction, {
              tenantId: principal.tenantId,
              actorUserId: principal.userId,
              subjectUserId: sharedData.ownerUserId ?? undefined,
              eventType: 'COMPLIANCE_FINDING_AUTOMATED_CREATED',
              outcome: 'SUCCESS',
              request,
              metadata: {
                evaluationRunId: runId,
                ruleId: rule.id,
                findingId,
                sourceReference: violation.sourceReference,
              },
            });
          } else if (action === 'REOPEN' && existing) {
            const reopened = await transaction.complianceFinding.update({
              where: {
                tenantId_id: {
                  tenantId: principal.tenantId,
                  id: existing.id,
                },
              },
              data: {
                ...sharedData,
                status: 'OPEN',
                resolvedAt: null,
                resolvedByUserId: null,
                resolutionNote: null,
              },
              select: { id: true, status: true },
            });
            findingId = reopened.id;
            findingStatus = reopened.status;
            findingsReopened += 1;
            await appendSecurityEvent(transaction, {
              tenantId: principal.tenantId,
              actorUserId: principal.userId,
              eventType: 'COMPLIANCE_FINDING_AUTOMATED_REOPENED',
              outcome: 'SUCCESS',
              request,
              metadata: { evaluationRunId: runId, ruleId: rule.id, findingId },
            });
          } else if (existing) {
            await transaction.complianceFinding.update({
              where: {
                tenantId_id: {
                  tenantId: principal.tenantId,
                  id: existing.id,
                },
              },
              data: sharedData,
            });
            findingId = existing.id;
            findingStatus = existing.status;
            findingsUnchanged += 1;
          } else {
            throw new Error('Finding reconciliation invariant was violated.');
          }
          if (details.length < maximumStoredViolationDetails) {
            details.push({
              findingId,
              findingStatus,
              sourceReference: violation.sourceReference,
              ...violation.details,
            });
          }
        }

        const toResolve = existingFindings.filter(
          (finding) =>
            finding.fingerprint &&
            !currentFingerprints.has(finding.fingerprint) &&
            shouldResolveMissingFinding(finding.status),
        );
        for (const finding of toResolve) {
          await transaction.complianceFinding.update({
            where: {
              tenantId_id: {
                tenantId: principal.tenantId,
                id: finding.id,
              },
            },
            data: {
              status: 'RESOLVED',
              resolvedAt: evaluatedAt,
              resolvedByUserId: principal.userId,
              resolutionNote:
                'Resolved automatically because the deterministic rule condition no longer matches.',
              lastEvaluationRunId: runId,
              lastEvaluatedAt: evaluatedAt,
            },
          });
          await appendSecurityEvent(transaction, {
            tenantId: principal.tenantId,
            actorUserId: principal.userId,
            eventType: 'COMPLIANCE_FINDING_AUTOMATED_RESOLVED',
            outcome: 'SUCCESS',
            request,
            metadata: {
              evaluationRunId: runId,
              ruleId: rule.id,
              findingId: finding.id,
            },
          });
        }

        const completedAt = new Date();
        await transaction.complianceRuleResult.create({
          data: {
            tenantId: principal.tenantId,
            evaluationRunId: runId,
            ruleId: rule.id,
            outcome: evaluation.violations.length ? 'FAILED' : 'PASSED',
            scannedCount: evaluation.scannedCount,
            violationCount: evaluation.violations.length,
            findingsCreated,
            findingsReopened,
            findingsResolved: toResolve.length,
            findingsUnchanged,
            details: {
              rule: {
                key: rule.key,
                name: rule.name,
                implementationKey: rule.implementationKey,
                severity: rule.severity,
                category: rule.category,
                requirementId: rule.requirementId,
                controlId: rule.controlId,
                configuration: rule.configuration,
              },
              violations: details,
              truncated:
                evaluation.violations.length > maximumStoredViolationDetails,
            },
            startedAt,
            completedAt,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_RULE_EVALUATED',
          outcome: 'SUCCESS',
          request,
          metadata: {
            evaluationRunId: runId,
            ruleId: rule.id,
            scannedCount: evaluation.scannedCount,
            violations: evaluation.violations.length,
            findingsCreated,
            findingsReopened,
            findingsResolved: toResolve.length,
          },
        });
      },
    );
  }

  private async recordRuleError(
    principal: AuthenticatedPrincipal,
    runId: string,
    ruleId: string,
    error: unknown,
    request: RequestMetadata,
  ): Promise<void> {
    const message = errorMessage(error);
    await this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        const existing = await transaction.complianceRuleResult.findUnique({
          where: {
            tenantId_evaluationRunId_ruleId: {
              tenantId: principal.tenantId,
              evaluationRunId: runId,
              ruleId,
            },
          },
          select: { id: true },
        });
        if (!existing) {
          const now = new Date();
          await transaction.complianceRuleResult.create({
            data: {
              tenantId: principal.tenantId,
              evaluationRunId: runId,
              ruleId,
              outcome: 'ERROR',
              errorMessage: message,
              startedAt: now,
              completedAt: now,
            },
          });
        }
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_RULE_EVALUATED',
          outcome: 'FAILURE',
          request,
          metadata: { evaluationRunId: runId, ruleId, error: message },
        });
      },
    );
  }

  private finalizeEvaluation(
    principal: AuthenticatedPrincipal,
    runId: string,
    request: RequestMetadata,
  ): Promise<ComplianceEvaluationRunResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        await lockComplianceTenant(transaction, principal.tenantId);
        const run = await transaction.complianceEvaluationRun.findFirstOrThrow({
          where: { id: runId, tenantId: principal.tenantId },
          include: runInclude,
        });
        if (run.status !== 'RUNNING') return mapRun(run);
        const results = await transaction.complianceRuleResult.findMany({
          where: { tenantId: principal.tenantId, evaluationRunId: runId },
          orderBy: { startedAt: 'asc' },
        });
        const errors = results.filter(({ outcome }) => outcome === 'ERROR');
        const status =
          errors.length === results.length
            ? 'FAILED'
            : errors.length
              ? 'PARTIAL'
              : 'COMPLETED';
        const totals = results.reduce(
          (sum, result) => ({
            violationsDetected: sum.violationsDetected + result.violationCount,
            findingsCreated: sum.findingsCreated + result.findingsCreated,
            findingsReopened: sum.findingsReopened + result.findingsReopened,
            findingsResolved: sum.findingsResolved + result.findingsResolved,
            findingsUnchanged: sum.findingsUnchanged + result.findingsUnchanged,
          }),
          {
            violationsDetected: 0,
            findingsCreated: 0,
            findingsReopened: 0,
            findingsResolved: 0,
            findingsUnchanged: 0,
          },
        );
        const completed = await transaction.complianceEvaluationRun.update({
          where: {
            tenantId_id: { tenantId: principal.tenantId, id: runId },
          },
          data: {
            status,
            completedAt: new Date(),
            rulesEvaluated: results.length,
            ...totals,
            errorSummary: errors.length
              ? errors
                  .map(({ errorMessage }) => errorMessage)
                  .filter(Boolean)
                  .join(' | ')
                  .slice(0, 3000)
              : null,
          },
          include: runInclude,
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'COMPLIANCE_EVALUATION_COMPLETED',
          outcome: status === 'FAILED' ? 'FAILURE' : 'SUCCESS',
          request,
          metadata: { evaluationRunId: runId, status, ...totals },
        });
        return mapRun(completed);
      },
    );
  }

  private loadRun(
    tenantId: string,
    evaluationId: string,
  ): Promise<ComplianceEvaluationRunResponseDto> {
    return this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      const run = await transaction.complianceEvaluationRun.findFirst({
        where: { id: evaluationId, tenantId },
        include: runInclude,
      });
      if (!run)
        throw complianceNotFound('Compliance evaluation was not found.');
      return mapRun(run);
    });
  }
}

async function assertRuleTargets(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  requirementId: string,
  controlId?: string,
  ownerUserId?: string,
): Promise<void> {
  const [requirement, control, owner] = await Promise.all([
    transaction.complianceRequirement.findFirst({
      where: { id: requirementId, tenantId },
      select: { id: true },
    }),
    controlId
      ? transaction.complianceControl.findFirst({
          where: {
            id: controlId,
            tenantId,
            requirementMappings: { some: { requirementId } },
          },
          select: { id: true },
        })
      : undefined,
    ownerUserId
      ? transaction.user.findFirst({
          where: { id: ownerUserId, tenantId, status: 'ACTIVE' },
          select: { id: true },
        })
      : undefined,
  ]);
  if (!requirement)
    throw complianceNotFound('Compliance requirement was not found.');
  if (controlId && !control) {
    throw complianceInvalid(
      'The selected control is not mapped to this requirement.',
    );
  }
  if (ownerUserId && !owner) {
    throw complianceInvalid(
      'The selected rule owner is not an active user in this organization.',
    );
  }
}

function mapRule(record: RuleRecord): ComplianceRuleResponseDto {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    implementationKey: record.implementationKey,
    category: record.category,
    severity: record.severity,
    enabled: record.enabled,
    configuration: jsonObject(record.configuration),
    framework: record.requirement.framework,
    requirement: {
      id: record.requirement.id,
      code: record.requirement.code,
      title: record.requirement.title,
    },
    control: record.control,
    owner: record.owner,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function mapRun(record: RunRecord): ComplianceEvaluationRunResponseDto {
  return {
    id: record.id,
    status: record.status,
    trigger: record.trigger,
    triggeredBy: record.triggeredBy,
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    rulesEvaluated: record.rulesEvaluated,
    violationsDetected: record.violationsDetected,
    findingsCreated: record.findingsCreated,
    findingsReopened: record.findingsReopened,
    findingsResolved: record.findingsResolved,
    findingsUnchanged: record.findingsUnchanged,
    errorSummary: record.errorSummary,
    results: record.results.map((result) => ({
      id: result.id,
      outcome: result.outcome,
      scannedCount: result.scannedCount,
      violationCount: result.violationCount,
      findingsCreated: result.findingsCreated,
      findingsReopened: result.findingsReopened,
      findingsResolved: result.findingsResolved,
      findingsUnchanged: result.findingsUnchanged,
      errorMessage: result.errorMessage,
      rule: { ...result.rule, ...storedRuleIdentity(result.details) },
      ruleSnapshot: jsonObject(jsonObject(result.details).rule ?? null),
      startedAt: result.startedAt.toISOString(),
      completedAt: result.completedAt.toISOString(),
    })),
  };
}

function findingFingerprint(ruleId: string, subjectKey: string): string {
  return createHash('sha256').update(`${ruleId}:${subjectKey}`).digest('hex');
}

function storedRuleIdentity(details: Prisma.JsonValue | null): {
  name?: string;
  key?: string;
} {
  const rule = jsonObject(jsonObject(details).rule ?? null);
  return {
    ...(typeof rule.name === 'string' ? { name: rule.name } : {}),
    ...(typeof rule.key === 'string' ? { key: rule.key } : {}),
  };
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Unknown rule error').slice(
    0,
    3000,
  );
}

function invalidConfiguration(error: unknown): ApplicationError {
  return complianceInvalid(
    `Invalid rule configuration: ${errorMessage(error)}`,
  );
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

const staleRunMilliseconds = 15 * 60 * 1000;
const maximumStoredViolationDetails = 100;

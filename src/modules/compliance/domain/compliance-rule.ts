import type { Prisma } from '../../../generated/prisma/client.js';
import type { ComplianceEvidenceSourceType } from './compliance-evidence-source.js';

export const complianceRuleImplementationKeys = [
  'CAPA_ACTION_OVERDUE_V1',
  'EQUIPMENT_CALIBRATION_OVERDUE_V1',
] as const;

export type ComplianceRuleImplementationKey =
  (typeof complianceRuleImplementationKeys)[number];

export interface ComplianceRuleConfigurationField {
  key: string;
  label: string;
  description: string;
  type: 'INTEGER';
  minimum: number;
  maximum: number;
  defaultValue: number;
}

export interface ComplianceRuleDefinition {
  implementationKey: ComplianceRuleImplementationKey;
  name: string;
  description: string;
  sourceEntityType: ComplianceEvidenceSourceType;
  defaultCategory: string;
  defaultSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION';
  configurationFields: readonly ComplianceRuleConfigurationField[];
}

export interface ComplianceRuleViolation {
  subjectKey: string;
  sourceEntityType: ComplianceEvidenceSourceType;
  sourceEntityId: string;
  sourceReference: string;
  title: string;
  description: string;
  dueAt: Date | null;
  ownerUserId: string | null;
  details: Prisma.InputJsonObject;
}

export interface ComplianceRuleEvaluation {
  scannedCount: number;
  violations: ComplianceRuleViolation[];
}

export interface ComplianceRuleEvaluationContext {
  transaction: Prisma.TransactionClient;
  tenantId: string;
  evaluatedAt: Date;
  configuration: Prisma.JsonValue | null;
}

export abstract class ComplianceRuleEvaluator {
  abstract readonly definition: ComplianceRuleDefinition;

  abstract normalizeConfiguration(
    configuration: unknown,
  ): Prisma.InputJsonObject;

  abstract evaluate(
    context: ComplianceRuleEvaluationContext,
  ): Promise<ComplianceRuleEvaluation>;
}

export const COMPLIANCE_RULE_EVALUATORS = Symbol('COMPLIANCE_RULE_EVALUATORS');

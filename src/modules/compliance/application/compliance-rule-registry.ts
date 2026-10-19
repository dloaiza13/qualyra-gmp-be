import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  COMPLIANCE_RULE_EVALUATORS,
  ComplianceRuleEvaluator,
  type ComplianceRuleDefinition,
  type ComplianceRuleImplementationKey,
} from '../domain/compliance-rule.js';

@Injectable()
export class ComplianceRuleRegistry {
  private readonly byKey: ReadonlyMap<
    ComplianceRuleImplementationKey,
    ComplianceRuleEvaluator
  >;

  constructor(
    @Inject(COMPLIANCE_RULE_EVALUATORS)
    evaluators: ComplianceRuleEvaluator[],
  ) {
    const entries = evaluators.map(
      (evaluator) =>
        [evaluator.definition.implementationKey, evaluator] as const,
    );
    this.byKey = new Map(entries);
    if (this.byKey.size !== entries.length) {
      throw new Error('Compliance rule implementation keys must be unique.');
    }
  }

  definitions(): ComplianceRuleDefinition[] {
    return [...this.byKey.values()].map(({ definition }) => definition);
  }

  has(
    implementationKey: string,
  ): implementationKey is ComplianceRuleImplementationKey {
    return this.byKey.has(implementationKey as ComplianceRuleImplementationKey);
  }

  get(
    implementationKey: ComplianceRuleImplementationKey,
  ): ComplianceRuleEvaluator {
    const evaluator = this.byKey.get(implementationKey);
    if (!evaluator) {
      throw new Error(`Unsupported compliance rule: ${implementationKey}.`);
    }
    return evaluator;
  }

  normalizeConfiguration(
    implementationKey: ComplianceRuleImplementationKey,
    configuration: unknown,
  ): Prisma.InputJsonObject {
    return this.get(implementationKey).normalizeConfiguration(configuration);
  }
}

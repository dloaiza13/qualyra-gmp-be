import type {
  ComplianceFindingSeverity,
  ComplianceFindingStatus,
  ComplianceReadinessStatus,
} from '../../../generated/prisma/client.js';

export interface ComplianceReadinessPolicyValues {
  version: number;
  criticalPenalty: number;
  majorPenalty: number;
  minorPenalty: number;
  observationPenalty: number;
  unmappedRequirementPenalty: number;
  missingEvidencePenalty: number;
  excellentMinimum: number;
  goodMinimum: number;
  needsAttentionMinimum: number;
  frameworkWeights: Record<string, number>;
  categoryWeights: Record<string, number>;
}

export interface ComplianceReadinessControlFact {
  id: string;
  category: string;
  hasValidEvidence: boolean;
}

export interface ComplianceReadinessRequirementFact {
  id: string;
  code: string;
  title: string;
  weight: number;
  mandatory: boolean;
  framework: {
    id: string;
    code: string;
    name: string;
    version: string;
  };
  hasDirectValidEvidence: boolean;
  controls: ComplianceReadinessControlFact[];
}

export interface ComplianceReadinessFindingFact {
  id: string;
  title: string;
  severity: ComplianceFindingSeverity;
  status: ComplianceFindingStatus;
  category: string;
  sourceReference: string | null;
  requirementId: string;
}

export type ComplianceReadinessDeductionType =
  'FINDING' | 'UNMAPPED_REQUIREMENT' | 'MISSING_EVIDENCE';

export interface ComplianceReadinessDeduction {
  key: string;
  type: ComplianceReadinessDeductionType;
  points: number;
  title: string;
  description: string;
  frameworkId: string;
  frameworkCode: string;
  requirementId: string;
  requirementCode: string;
  category: string;
  findingId: string | null;
  severity: ComplianceFindingSeverity | null;
  sourceReference: string | null;
}

export interface ComplianceReadinessResult {
  calculatedAt: string;
  overallScore: number | null;
  status: ComplianceReadinessStatus;
  eligible: boolean;
  methodology: {
    startingScore: 100;
    policy: ComplianceReadinessPolicyValues;
    totalDeduction: number;
    deductionsReturned: number;
    deductionsTruncated: boolean;
  };
  coverage: {
    activeFrameworks: number;
    totalRequirements: number;
    mandatoryRequirements: number;
    mappedRequirements: number;
    evidenceCoveredRequirements: number;
    mappingPercent: number | null;
    evidenceCoveragePercent: number | null;
  };
  findings: {
    critical: number;
    major: number;
    minor: number;
    observation: number;
    acceptedRisk: number;
    activeTotal: number;
  };
  frameworks: {
    id: string;
    code: string;
    name: string;
    version: string;
    score: number;
    requirements: number;
    mappedRequirements: number;
    evidenceCoveredRequirements: number;
    activeFindings: number;
    totalDeduction: number;
  }[];
  categories: {
    name: string;
    score: number;
    controls: number;
    activeFindings: number;
    totalDeduction: number;
  }[];
  deductions: ComplianceReadinessDeduction[];
}

export const defaultComplianceReadinessPolicy: ComplianceReadinessPolicyValues =
  {
    version: 1,
    criticalPenalty: 15,
    majorPenalty: 5,
    minorPenalty: 2,
    observationPenalty: 0.5,
    unmappedRequirementPenalty: 5,
    missingEvidencePenalty: 2,
    excellentMinimum: 90,
    goodMinimum: 75,
    needsAttentionMinimum: 50,
    frameworkWeights: {},
    categoryWeights: {},
  };

export function calculateComplianceReadiness(input: {
  calculatedAt: Date;
  policy: ComplianceReadinessPolicyValues;
  requirements: ComplianceReadinessRequirementFact[];
  findings: ComplianceReadinessFindingFact[];
}): ComplianceReadinessResult {
  const { calculatedAt, policy, requirements, findings } = input;
  const activeFindings = findings.filter(
    ({ status }) => status === 'OPEN' || status === 'IN_PROGRESS',
  );
  const acceptedRisk = findings.filter(
    ({ status }) => status === 'ACCEPTED_RISK',
  ).length;
  const requirementsById = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  );
  const deductions: ComplianceReadinessDeduction[] = [];

  for (const finding of activeFindings) {
    const requirement = requirementsById.get(finding.requirementId);
    if (!requirement) continue;
    const points = roundedPoints(
      severityPenalty(policy, finding.severity) *
        normalizedWeight(requirement.weight) *
        frameworkWeight(policy, requirement.framework) *
        categoryWeight(policy, finding.category),
    );
    deductions.push({
      key: `FINDING:${finding.id}`,
      type: 'FINDING',
      points,
      title: finding.title,
      description: `${finding.severity} finding affecting ${requirement.framework.code} ${requirement.code}.`,
      frameworkId: requirement.framework.id,
      frameworkCode: requirement.framework.code,
      requirementId: requirement.id,
      requirementCode: requirement.code,
      category: finding.category,
      findingId: finding.id,
      severity: finding.severity,
      sourceReference: finding.sourceReference,
    });
  }

  for (const requirement of requirements) {
    if (!requirement.mandatory) continue;
    const frameworkMultiplier = frameworkWeight(policy, requirement.framework);
    const requirementMultiplier = normalizedWeight(requirement.weight);
    if (!requirement.controls.length) {
      const category = 'Unmapped requirements';
      deductions.push({
        key: `UNMAPPED_REQUIREMENT:${requirement.id}`,
        type: 'UNMAPPED_REQUIREMENT',
        points: roundedPoints(
          policy.unmappedRequirementPenalty *
            requirementMultiplier *
            frameworkMultiplier *
            categoryWeight(policy, category),
        ),
        title: `${requirement.framework.code} ${requirement.code}: control not mapped`,
        description:
          'This mandatory requirement has no active internal control mapped to it.',
        frameworkId: requirement.framework.id,
        frameworkCode: requirement.framework.code,
        requirementId: requirement.id,
        requirementCode: requirement.code,
        category,
        findingId: null,
        severity: null,
        sourceReference: null,
      });
      continue;
    }
    const hasValidEvidence =
      requirement.hasDirectValidEvidence ||
      requirement.controls.some((control) => control.hasValidEvidence);
    if (hasValidEvidence) continue;
    const categories = [
      ...new Set(requirement.controls.map(({ category }) => category)),
    ];
    const category =
      categories.length === 1 ? categories[0] : 'Cross-functional';
    deductions.push({
      key: `MISSING_EVIDENCE:${requirement.id}`,
      type: 'MISSING_EVIDENCE',
      points: roundedPoints(
        policy.missingEvidencePenalty *
          requirementMultiplier *
          frameworkMultiplier *
          categoryWeight(policy, category),
      ),
      title: `${requirement.framework.code} ${requirement.code}: current evidence missing`,
      description:
        'The mapped control has no evidence that is current on the calculation date.',
      frameworkId: requirement.framework.id,
      frameworkCode: requirement.framework.code,
      requirementId: requirement.id,
      requirementCode: requirement.code,
      category,
      findingId: null,
      severity: null,
      sourceReference: null,
    });
  }

  const frameworkMap = new Map(
    requirements.map(({ framework }) => [framework.id, framework]),
  );
  const frameworkScores = [...frameworkMap.values()]
    .map((framework) => {
      const scopedRequirements = requirements.filter(
        (requirement) => requirement.framework.id === framework.id,
      );
      const scopedDeductions = deductions.filter(
        (deduction) => deduction.frameworkId === framework.id,
      );
      const totalDeduction = sumPoints(scopedDeductions);
      return {
        ...framework,
        score: readinessScore(totalDeduction),
        requirements: scopedRequirements.length,
        mappedRequirements: scopedRequirements.filter(
          ({ controls }) => controls.length > 0,
        ).length,
        evidenceCoveredRequirements: scopedRequirements.filter(
          hasRequirementEvidence,
        ).length,
        activeFindings: activeFindings.filter((finding) => {
          const requirement = requirementsById.get(finding.requirementId);
          return requirement?.framework.id === framework.id;
        }).length,
        totalDeduction,
      };
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.code.localeCompare(right.code),
    );

  const controlCategories = new Map<string, Set<string>>();
  for (const requirement of requirements) {
    for (const control of requirement.controls) {
      const ids = controlCategories.get(control.category) ?? new Set<string>();
      ids.add(control.id);
      controlCategories.set(control.category, ids);
    }
  }
  const categoryNames = new Set([
    ...controlCategories.keys(),
    ...activeFindings.map(({ category }) => category),
    ...deductions.map(({ category }) => category),
  ]);
  const categories = [...categoryNames]
    .map((name) => {
      const scopedDeductions = deductions.filter(
        (deduction) => deduction.category === name,
      );
      const totalDeduction = sumPoints(scopedDeductions);
      return {
        name,
        score: readinessScore(totalDeduction),
        controls: controlCategories.get(name)?.size ?? 0,
        activeFindings: activeFindings.filter(
          ({ category }) => category === name,
        ).length,
        totalDeduction,
      };
    })
    .sort(
      (left, right) =>
        left.score - right.score || left.name.localeCompare(right.name),
    );

  const totalRequirements = requirements.length;
  const mappedRequirements = requirements.filter(
    ({ controls }) => controls.length > 0,
  ).length;
  const evidenceCoveredRequirements = requirements.filter(
    hasRequirementEvidence,
  ).length;
  const totalDeduction = sumPoints(deductions);
  const overallScore = totalRequirements
    ? readinessScore(totalDeduction)
    : null;
  const orderedDeductions = [...deductions].sort(
    (left, right) =>
      right.points - left.points || left.title.localeCompare(right.title),
  );

  return {
    calculatedAt: calculatedAt.toISOString(),
    overallScore,
    status:
      overallScore === null
        ? 'NOT_ENOUGH_DATA'
        : readinessStatus(overallScore, policy),
    eligible: overallScore !== null,
    methodology: {
      startingScore: 100,
      policy,
      totalDeduction,
      deductionsReturned: Math.min(
        orderedDeductions.length,
        maximumReturnedDeductions,
      ),
      deductionsTruncated: orderedDeductions.length > maximumReturnedDeductions,
    },
    coverage: {
      activeFrameworks: frameworkMap.size,
      totalRequirements,
      mandatoryRequirements: requirements.filter(({ mandatory }) => mandatory)
        .length,
      mappedRequirements,
      evidenceCoveredRequirements,
      mappingPercent: percentage(mappedRequirements, totalRequirements),
      evidenceCoveragePercent: percentage(
        evidenceCoveredRequirements,
        totalRequirements,
      ),
    },
    findings: {
      critical: countSeverity(activeFindings, 'CRITICAL'),
      major: countSeverity(activeFindings, 'MAJOR'),
      minor: countSeverity(activeFindings, 'MINOR'),
      observation: countSeverity(activeFindings, 'OBSERVATION'),
      acceptedRisk,
      activeTotal: activeFindings.length,
    },
    frameworks: frameworkScores,
    categories,
    deductions: orderedDeductions.slice(0, maximumReturnedDeductions),
  };
}

function hasRequirementEvidence(
  requirement: ComplianceReadinessRequirementFact,
): boolean {
  return (
    requirement.hasDirectValidEvidence ||
    requirement.controls.some(({ hasValidEvidence }) => hasValidEvidence)
  );
}

function severityPenalty(
  policy: ComplianceReadinessPolicyValues,
  severity: ComplianceFindingSeverity,
): number {
  return {
    CRITICAL: policy.criticalPenalty,
    MAJOR: policy.majorPenalty,
    MINOR: policy.minorPenalty,
    OBSERVATION: policy.observationPenalty,
  }[severity];
}

function frameworkWeight(
  policy: ComplianceReadinessPolicyValues,
  framework: ComplianceReadinessRequirementFact['framework'],
): number {
  return (
    policy.frameworkWeights[framework.id] ??
    policy.frameworkWeights[`${framework.code}:${framework.version}`] ??
    policy.frameworkWeights[framework.code] ??
    1
  );
}

function categoryWeight(
  policy: ComplianceReadinessPolicyValues,
  category: string,
): number {
  return policy.categoryWeights[category] ?? 1;
}

function normalizedWeight(weight: number): number {
  return Math.max(0, weight);
}

function roundedPoints(points: number): number {
  return Math.round(points * 100) / 100;
}

function sumPoints(deductions: ComplianceReadinessDeduction[]): number {
  return roundedPoints(
    deductions.reduce((sum, deduction) => sum + deduction.points, 0),
  );
}

function readinessScore(deduction: number): number {
  return Math.round(Math.max(0, Math.min(100, 100 - deduction)) * 10) / 10;
}

function readinessStatus(
  score: number,
  policy: ComplianceReadinessPolicyValues,
): ComplianceReadinessStatus {
  if (score >= policy.excellentMinimum) return 'EXCELLENT';
  if (score >= policy.goodMinimum) return 'GOOD';
  if (score >= policy.needsAttentionMinimum) return 'NEEDS_ATTENTION';
  return 'HIGH_RISK';
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function countSeverity(
  findings: ComplianceReadinessFindingFact[],
  severity: ComplianceFindingSeverity,
): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

const maximumReturnedDeductions = 100;

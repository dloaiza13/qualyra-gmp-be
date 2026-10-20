import {
  calculateComplianceReadiness,
  defaultComplianceReadinessPolicy,
  type ComplianceReadinessFindingFact,
  type ComplianceReadinessRequirementFact,
} from './compliance-readiness.js';

const framework = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'ISO-13485',
  name: 'ISO 13485',
  version: '2016',
};

function requirement(
  input: Partial<ComplianceReadinessRequirementFact> = {},
): ComplianceReadinessRequirementFact {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    code: '7.6',
    title: 'Monitoring and measuring equipment',
    weight: 1,
    mandatory: true,
    framework,
    hasDirectValidEvidence: false,
    controls: [],
    ...input,
  };
}

function finding(
  input: Partial<ComplianceReadinessFindingFact> = {},
): ComplianceReadinessFindingFact {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    title: 'Calibration expired',
    severity: 'CRITICAL',
    status: 'OPEN',
    category: 'Calibration',
    sourceReference: 'EQ-001',
    requirementId: '00000000-0000-4000-8000-000000000101',
    ...input,
  };
}

describe('compliance audit readiness scoring', () => {
  it('withholds the score when there is no active requirement basis', () => {
    const result = calculateComplianceReadiness({
      calculatedAt: new Date('2026-10-19T12:00:00.000Z'),
      policy: defaultComplianceReadinessPolicy,
      requirements: [],
      findings: [],
    });

    expect(result.overallScore).toBeNull();
    expect(result.status).toBe('NOT_ENOUGH_DATA');
    expect(result.coverage.mappingPercent).toBeNull();
  });

  it('explains finding, mapping and evidence deductions without double counting', () => {
    const requirements = [
      requirement(),
      requirement({
        id: '00000000-0000-4000-8000-000000000102',
        code: '8.5.2',
        weight: 2,
        controls: [
          {
            id: '00000000-0000-4000-8000-000000000301',
            category: 'CAPA',
            hasValidEvidence: false,
          },
        ],
      }),
    ];
    const result = calculateComplianceReadiness({
      calculatedAt: new Date('2026-10-19T12:00:00.000Z'),
      policy: defaultComplianceReadinessPolicy,
      requirements,
      findings: [finding()],
    });

    expect(result.overallScore).toBe(76);
    expect(result.status).toBe('GOOD');
    expect(result.methodology.totalDeduction).toBe(24);
    expect(
      result.deductions.map(({ type, points }) => ({ type, points })),
    ).toEqual([
      { type: 'FINDING', points: 15 },
      { type: 'UNMAPPED_REQUIREMENT', points: 5 },
      { type: 'MISSING_EVIDENCE', points: 4 },
    ]);
    expect(result.coverage).toMatchObject({
      totalRequirements: 2,
      mappedRequirements: 1,
      evidenceCoveredRequirements: 0,
      mappingPercent: 50,
    });
  });

  it('applies framework, category and requirement weights transparently', () => {
    const policy = {
      ...defaultComplianceReadinessPolicy,
      frameworkWeights: { 'ISO-13485': 1.5 },
      categoryWeights: { Calibration: 2 },
    };
    const result = calculateComplianceReadiness({
      calculatedAt: new Date('2026-10-19T12:00:00.000Z'),
      policy,
      requirements: [
        requirement({
          weight: 2,
          hasDirectValidEvidence: true,
          controls: [
            {
              id: '00000000-0000-4000-8000-000000000301',
              category: 'Calibration',
              hasValidEvidence: true,
            },
          ],
        }),
      ],
      findings: [finding({ severity: 'MAJOR' })],
    });

    expect(result.methodology.totalDeduction).toBe(30);
    expect(result.overallScore).toBe(70);
    expect(result.frameworks[0]?.score).toBe(70);
    expect(result.categories[0]).toMatchObject({
      name: 'Calibration',
      score: 70,
    });
  });

  it('excludes resolved and accepted-risk findings from active penalties while reporting risk acceptance', () => {
    const result = calculateComplianceReadiness({
      calculatedAt: new Date('2026-10-19T12:00:00.000Z'),
      policy: defaultComplianceReadinessPolicy,
      requirements: [
        requirement({
          hasDirectValidEvidence: true,
          controls: [
            {
              id: '00000000-0000-4000-8000-000000000301',
              category: 'Calibration',
              hasValidEvidence: true,
            },
          ],
        }),
      ],
      findings: [
        finding({ status: 'RESOLVED' }),
        finding({
          id: '00000000-0000-4000-8000-000000000202',
          status: 'ACCEPTED_RISK',
        }),
      ],
    });

    expect(result.overallScore).toBe(100);
    expect(result.findings.activeTotal).toBe(0);
    expect(result.findings.acceptedRisk).toBe(1);
  });
});

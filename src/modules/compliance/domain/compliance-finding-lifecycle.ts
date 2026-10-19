import type { ComplianceFindingStatus } from '../../../generated/prisma/client.js';

const transitions: Record<
  ComplianceFindingStatus,
  readonly ComplianceFindingStatus[]
> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'ACCEPTED_RISK'],
  RESOLVED: ['OPEN'],
  ACCEPTED_RISK: ['OPEN'],
};

export function canTransitionComplianceFinding(
  current: ComplianceFindingStatus,
  next: ComplianceFindingStatus,
): boolean {
  return current === next || transitions[current].includes(next);
}

export function isClosedComplianceFinding(
  status: ComplianceFindingStatus,
): boolean {
  return status === 'RESOLVED' || status === 'ACCEPTED_RISK';
}

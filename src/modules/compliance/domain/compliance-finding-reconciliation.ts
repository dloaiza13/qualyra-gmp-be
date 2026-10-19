import type { ComplianceFindingStatus } from '../../../generated/prisma/client.js';

export type MatchedFindingAction = 'CREATE' | 'REOPEN' | 'REFRESH';

export function matchedFindingAction(
  status: ComplianceFindingStatus | null,
): MatchedFindingAction {
  if (status === null) return 'CREATE';
  if (status === 'RESOLVED') return 'REOPEN';
  return 'REFRESH';
}

export function shouldResolveMissingFinding(
  status: ComplianceFindingStatus,
): boolean {
  return status === 'OPEN' || status === 'IN_PROGRESS';
}

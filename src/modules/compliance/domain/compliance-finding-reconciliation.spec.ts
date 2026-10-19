import {
  matchedFindingAction,
  shouldResolveMissingFinding,
} from './compliance-finding-reconciliation.js';

describe('automated compliance finding reconciliation', () => {
  it('creates new matches, reopens recurring resolved matches and refreshes active ones', () => {
    expect(matchedFindingAction(null)).toBe('CREATE');
    expect(matchedFindingAction('RESOLVED')).toBe('REOPEN');
    expect(matchedFindingAction('OPEN')).toBe('REFRESH');
    expect(matchedFindingAction('IN_PROGRESS')).toBe('REFRESH');
  });

  it('preserves accepted risk even when a later evaluation no longer matches', () => {
    expect(matchedFindingAction('ACCEPTED_RISK')).toBe('REFRESH');
    expect(shouldResolveMissingFinding('ACCEPTED_RISK')).toBe(false);
  });

  it('resolves only active findings absent from a successful re-evaluation', () => {
    expect(shouldResolveMissingFinding('OPEN')).toBe(true);
    expect(shouldResolveMissingFinding('IN_PROGRESS')).toBe(true);
    expect(shouldResolveMissingFinding('RESOLVED')).toBe(false);
  });
});

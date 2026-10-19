import {
  canTransitionComplianceFinding,
  isClosedComplianceFinding,
} from './compliance-finding-lifecycle.js';

describe('compliance finding lifecycle', () => {
  it('supports controlled progress, closure and re-evaluation', () => {
    expect(canTransitionComplianceFinding('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionComplianceFinding('IN_PROGRESS', 'RESOLVED')).toBe(
      true,
    );
    expect(canTransitionComplianceFinding('RESOLVED', 'OPEN')).toBe(true);
    expect(canTransitionComplianceFinding('RESOLVED', 'IN_PROGRESS')).toBe(
      false,
    );
  });

  it('treats resolved and accepted risk as closed outcomes', () => {
    expect(isClosedComplianceFinding('RESOLVED')).toBe(true);
    expect(isClosedComplianceFinding('ACCEPTED_RISK')).toBe(true);
    expect(isClosedComplianceFinding('OPEN')).toBe(false);
  });
});

import { ErrorCode } from '../../../common/errors/error-codes.js';
import { CommercialEntitlementPolicy } from './commercial-entitlement.policy.js';

describe('CommercialEntitlementPolicy', () => {
  const policy = new CommercialEntitlementPolicy();
  const activeTrial = {
    plan: 'TRIAL' as const,
    trialEndsAt: new Date('2026-09-01T00:00:00.000Z'),
  };
  const now = new Date('2026-08-20T00:00:00.000Z');

  it('describes plan seats, trial duration, and module access', () => {
    expect(policy.describe(activeTrial, 3, now)).toMatchObject({
      userLimit: 5,
      committedUsers: 3,
      remainingUserSeats: 2,
      trialExpired: false,
      trialDaysRemaining: 12,
      writeAccess: true,
    });
  });

  it('keeps excluded Starter modules readable while removing mutations', () => {
    const permissions = policy.effectivePermissions(
      ['audits.read', 'audits.plan', 'documents.read', 'documents.create'],
      { plan: 'STARTER', trialEndsAt: null },
      now,
    );
    expect([...permissions]).toEqual([
      'audits.read',
      'documents.read',
      'documents.create',
    ]);
  });

  it('makes an expired trial read-only and rejects new seats', () => {
    const expired = {
      plan: 'TRIAL' as const,
      trialEndsAt: new Date('2026-08-19T00:00:00.000Z'),
    };
    expect([
      ...policy.effectivePermissions(
        ['documents.read', 'documents.create'],
        expired,
        now,
      ),
    ]).toEqual(['documents.read']);
    expectErrorCode(
      () => policy.assertCanAllocateSeat(expired, 1, { now }),
      ErrorCode.TrialExpired,
    );
  });

  it('reserves pending invitations within the plan user limit', () => {
    expectErrorCode(
      () => policy.assertCanAllocateSeat(activeTrial, 5, { now }),
      ErrorCode.PlanUserLimitReached,
    );
    expect(() =>
      policy.assertCanAllocateSeat(activeTrial, 8, {
        now,
        reservedSeat: true,
      }),
    ).not.toThrow();
  });
});

function expectErrorCode(action: () => void, code: string): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code} to be thrown.`);
}

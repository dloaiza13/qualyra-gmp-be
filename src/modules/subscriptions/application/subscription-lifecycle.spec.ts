import {
  effectiveSubscriptionStatus,
  mapSubscriptionSummary,
  subscriptionAllowsWrites,
} from './subscription-lifecycle.js';

const now = new Date('2026-08-20T12:00:00.000Z');

describe('subscription lifecycle', () => {
  it('derives an expired grace period without mutating persisted history', () => {
    const subscription = {
      status: 'GRACE_PERIOD' as const,
      billingInterval: 'MONTHLY' as const,
      provider: 'MANUAL',
      currentPeriodStartsAt: new Date('2026-07-01T00:00:00.000Z'),
      currentPeriodEndsAt: new Date('2026-08-01T00:00:00.000Z'),
      graceEndsAt: new Date('2026-08-20T11:59:59.000Z'),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    };
    expect(effectiveSubscriptionStatus(subscription, now)).toBe('EXPIRED');
    expect(subscriptionAllowsWrites(subscription, now)).toBe(false);
    expect(mapSubscriptionSummary(subscription, now)).toMatchObject({
      status: 'EXPIRED',
      writeAccess: false,
      attentionRequired: true,
    });
    expect(subscription.status).toBe('GRACE_PERIOD');
  });

  it('keeps scheduled cancellation writable until period end', () => {
    const subscription = {
      status: 'CANCEL_SCHEDULED' as const,
      billingInterval: 'ANNUAL' as const,
      provider: 'MANUAL',
      currentPeriodStartsAt: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEndsAt: new Date('2026-12-31T23:59:59.000Z'),
      graceEndsAt: null,
      cancelAtPeriodEnd: true,
      canceledAt: null,
      updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    };
    expect(subscriptionAllowsWrites(subscription, now)).toBe(true);
    expect(mapSubscriptionSummary(subscription, now)).toMatchObject({
      status: 'CANCEL_SCHEDULED',
      writeAccess: true,
      attentionRequired: true,
    });
  });
});

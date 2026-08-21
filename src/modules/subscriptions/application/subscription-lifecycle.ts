import type {
  BillingInterval,
  SubscriptionStatus,
} from '../../../generated/prisma/client.js';

export interface SubscriptionSnapshot {
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  provider: string;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  updatedAt: Date;
}

export interface SubscriptionSummary {
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  provider: string;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  writeAccess: boolean;
  attentionRequired: boolean;
  updatedAt: string;
}

export function effectiveSubscriptionStatus(
  subscription: Pick<
    SubscriptionSnapshot,
    'status' | 'currentPeriodEndsAt' | 'graceEndsAt'
  >,
  now = new Date(),
): SubscriptionStatus {
  if (
    subscription.status === 'GRACE_PERIOD' &&
    (!subscription.graceEndsAt || subscription.graceEndsAt <= now)
  ) {
    return 'EXPIRED';
  }
  if (
    subscription.status === 'CANCEL_SCHEDULED' &&
    (!subscription.currentPeriodEndsAt ||
      subscription.currentPeriodEndsAt <= now)
  ) {
    return 'CANCELED';
  }
  if (
    subscription.status === 'TRIALING' &&
    (!subscription.currentPeriodEndsAt ||
      subscription.currentPeriodEndsAt <= now)
  ) {
    return 'EXPIRED';
  }
  return subscription.status;
}

export function subscriptionAllowsWrites(
  subscription: Pick<
    SubscriptionSnapshot,
    'status' | 'currentPeriodEndsAt' | 'graceEndsAt'
  >,
  now = new Date(),
): boolean {
  return !['CANCELED', 'EXPIRED'].includes(
    effectiveSubscriptionStatus(subscription, now),
  );
}

export function mapSubscriptionSummary(
  subscription: SubscriptionSnapshot,
  now = new Date(),
): SubscriptionSummary {
  const status = effectiveSubscriptionStatus(subscription, now);
  return {
    status,
    billingInterval: subscription.billingInterval,
    provider: subscription.provider,
    currentPeriodStartsAt:
      subscription.currentPeriodStartsAt?.toISOString() ?? null,
    currentPeriodEndsAt:
      subscription.currentPeriodEndsAt?.toISOString() ?? null,
    graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
    writeAccess: subscriptionAllowsWrites(subscription, now),
    attentionRequired: [
      'GRACE_PERIOD',
      'CANCEL_SCHEDULED',
      'CANCELED',
      'EXPIRED',
    ].includes(status),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

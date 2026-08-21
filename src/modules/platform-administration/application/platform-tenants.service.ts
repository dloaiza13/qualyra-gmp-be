import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type {
  Prisma,
  TenantSubscription,
  TenantPlan,
  TenantStatus,
  UserStatus,
} from '../../../generated/prisma/client.js';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import { AuthenticationService } from '../../authentication/application/authentication.service.js';
import { CommercialEntitlementPolicy } from '../../commercial-entitlements/application/commercial-entitlement.policy.js';
import { PhotoEvidenceCapacityPolicy } from '../../photo-evidence/application/photo-evidence-capacity.policy.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  PlatformAuditEventQueryDto,
  CreatePlatformTenantDto,
  ProcessBillingProviderEventDto,
  PlatformTenantQueryDto,
  UpdatePlatformSubscriptionDto,
  UpdatePlatformTenantDto,
} from './dto/platform-tenant-request.dto.js';
import type {
  BillingProviderEventReceiptDto,
  PlatformAuditEventPageResponseDto,
  PlatformTenantPageResponseDto,
  PlatformTenantResponseDto,
} from './dto/platform-tenant-response.dto.js';
import {
  mapSubscriptionSummary,
  type SubscriptionSummary,
} from '../../subscriptions/application/subscription-lifecycle.js';

type TenantSnapshot = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: TenantPlan;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PlatformTenantsService {
  private readonly operatorId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly capacityPolicy: PhotoEvidenceCapacityPolicy,
    private readonly authentication: AuthenticationService,
    private readonly commercialEntitlements: CommercialEntitlementPolicy,
    config: ConfigService<Environment, true>,
  ) {
    this.operatorId = config.getOrThrow('PLATFORM_OPERATOR_ID', {
      infer: true,
    });
  }

  async create(
    input: CreatePlatformTenantDto,
    request: RequestMetadata,
  ): Promise<PlatformTenantResponseDto> {
    const { tenantId } = await this.authentication.provisionCompany(
      {
        ...input,
        reason: input.reason.trim(),
        operatorId: this.operatorId,
      },
      request,
    );
    return this.get(tenantId);
  }

  async list(
    query: PlatformTenantQueryDto,
  ): Promise<PlatformTenantPageResponseDto> {
    let cursorPosition: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorPosition = await this.prisma.tenant.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, id: true },
      });
      if (!cursorPosition) throw invalidTenant('The tenant cursor is invalid.');
    }
    const search = query.search?.trim();
    const conditions: Prisma.TenantWhereInput[] = [];
    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (cursorPosition) {
      conditions.push({
        OR: [
          { createdAt: { lt: cursorPosition.createdAt } },
          {
            createdAt: cursorPosition.createdAt,
            id: { lt: cursorPosition.id },
          },
        ],
      });
    }
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: query.status,
        plan: query.plan,
        AND: conditions,
      },
      select: tenantSelection,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = tenants.length > query.limit;
    const page = hasMore ? tenants.slice(0, query.limit) : tenants;
    const items: PlatformTenantResponseDto[] = [];
    for (const batch of batchesOf(page, 5)) {
      items.push(
        ...(await Promise.all(batch.map((tenant) => this.enrich(tenant)))),
      );
    }
    return {
      items,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(tenantId: string): Promise<PlatformTenantResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: tenantSelection,
    });
    if (!tenant) throw tenantNotFound();
    return this.enrich(tenant);
  }

  async update(
    tenantId: string,
    input: UpdatePlatformTenantDto,
    request: RequestMetadata,
  ): Promise<PlatformTenantResponseDto> {
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw invalidTenant('A meaningful commercial change reason is required.');
    }
    await this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(
          hashtextextended(${`${tenantId}:commercial-seat-allocation`}, 0)
        )
      `;
      const locked = await transaction.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM tenants
        WHERE id = ${tenantId}::uuid
        FOR UPDATE
      `;
      if (locked.length !== 1) throw tenantNotFound();
      const current = await transaction.tenant.findUnique({
        where: { id: tenantId },
        select: tenantSelection,
      });
      if (!current) throw tenantNotFound();
      if (
        new Date(input.expectedUpdatedAt).getTime() !==
        current.updatedAt.getTime()
      ) {
        throw new ApplicationError(
          ErrorCode.PlatformTenantConflict,
          'The organization changed after it was loaded.',
          HttpStatus.CONFLICT,
        );
      }
      const nextPlan = input.plan ?? current.plan;
      const nextStatus = input.status ?? current.status;
      if (nextPlan === current.plan && nextStatus === current.status) {
        throw invalidTenant('The requested commercial state has no changes.');
      }

      const [usage, commitments] = await Promise.all([
        readStorageUsage(transaction, tenantId),
        readUserCommitments(transaction, tenantId, new Date()),
      ]);
      const nextQuota = this.capacityPolicy.quotaFor(nextPlan);
      if (usage.usedBytes > nextQuota && !input.acknowledgeOverQuota) {
        throw new ApplicationError(
          ErrorCode.PlatformTenantConflict,
          'The selected plan is below the photographic evidence currently stored.',
          HttpStatus.CONFLICT,
          [{ usedBytes: usage.usedBytes, nextQuotaBytes: nextQuota }],
        );
      }

      const nextUserLimit = this.commercialEntitlements.userLimitFor(nextPlan);
      if (
        nextUserLimit !== null &&
        commitments.committedUsers > nextUserLimit &&
        !input.acknowledgeUserOverage
      ) {
        throw new ApplicationError(
          ErrorCode.PlatformTenantConflict,
          'The selected plan is below the users currently committed.',
          HttpStatus.CONFLICT,
          [
            {
              committedUsers: commitments.committedUsers,
              nextUserLimit,
            },
          ],
        );
      }

      const now = new Date();
      const nextTrialEndsAt =
        nextPlan === 'TRIAL' && current.plan !== 'TRIAL'
          ? this.commercialEntitlements.trialEndsAt(now)
          : current.trialEndsAt;
      let revokedSessions = 0;
      let revokedRefreshTokens = 0;
      if (current.status === 'ACTIVE' && nextStatus !== 'ACTIVE') {
        revokedSessions = (
          await transaction.session.updateMany({
            where: { tenantId, status: 'ACTIVE' },
            data: {
              status: 'REVOKED',
              revokedAt: now,
              revokeReason: `PLATFORM_TENANT_${nextStatus}`,
            },
          })
        ).count;
        revokedRefreshTokens = (
          await transaction.refreshToken.updateMany({
            where: { tenantId, revokedAt: null },
            data: { revokedAt: now },
          })
        ).count;
      }

      await transaction.tenant.update({
        where: { id: tenantId },
        data: {
          plan: nextPlan,
          status: nextStatus,
          trialEndsAt: nextTrialEndsAt,
        },
      });
      if (nextPlan !== current.plan) {
        const subscription = await transaction.tenantSubscription.findUnique({
          where: { tenantId },
        });
        if (subscription) {
          await transaction.tenantSubscription.update({
            where: { tenantId },
            data:
              nextPlan === 'TRIAL'
                ? {
                    status: 'TRIALING',
                    billingInterval: 'NONE',
                    currentPeriodStartsAt: now,
                    currentPeriodEndsAt: nextTrialEndsAt,
                    graceEndsAt: null,
                    cancelAtPeriodEnd: false,
                    canceledAt: null,
                  }
                : {
                    status: ['CANCELED', 'EXPIRED'].includes(
                      subscription.status,
                    )
                      ? 'ACTIVE'
                      : undefined,
                    billingInterval:
                      subscription.billingInterval === 'NONE'
                        ? 'MONTHLY'
                        : undefined,
                    currentPeriodStartsAt:
                      current.plan === 'TRIAL' ? now : undefined,
                    currentPeriodEndsAt:
                      current.plan === 'TRIAL' ? null : undefined,
                    graceEndsAt: current.plan === 'TRIAL' ? null : undefined,
                    cancelAtPeriodEnd:
                      current.plan === 'TRIAL' ? false : undefined,
                    canceledAt: current.plan === 'TRIAL' ? null : undefined,
                  },
          });
        }
      }
      await transaction.platformAuditEvent.create({
        data: {
          tenantId,
          operatorId: this.operatorId,
          eventType: 'PLATFORM_TENANT_COMMERCIAL_STATE_CHANGED',
          outcome: 'SUCCESS',
          reason,
          correlationId: request.correlationId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent?.slice(0, 1024),
          metadata: {
            previous: { plan: current.plan, status: current.status },
            next: { plan: nextPlan, status: nextStatus },
            overQuotaAcknowledged:
              usage.usedBytes > nextQuota && input.acknowledgeOverQuota,
            usedBytes: usage.usedBytes,
            quotaBytes: nextQuota,
            userOverageAcknowledged:
              nextUserLimit !== null &&
              commitments.committedUsers > nextUserLimit &&
              input.acknowledgeUserOverage,
            committedUsers: commitments.committedUsers,
            userLimit: nextUserLimit,
            trialEndsAt: nextTrialEndsAt?.toISOString() ?? null,
            revokedSessions,
            revokedRefreshTokens,
          },
        },
      });
    });
    return this.get(tenantId);
  }

  async updateSubscription(
    tenantId: string,
    input: UpdatePlatformSubscriptionDto,
    request: RequestMetadata,
  ): Promise<SubscriptionSummary> {
    const reason = input.reason.trim();
    const result = await this.tenantUnitOfWork.execute(
      tenantId,
      async (transaction) => {
        await lockCommercialState(transaction, tenantId);
        const [tenant, current] = await Promise.all([
          transaction.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, plan: true },
          }),
          transaction.tenantSubscription.findUnique({ where: { tenantId } }),
        ]);
        if (!tenant) throw tenantNotFound();
        if (!current)
          throw invalidSubscription('The subscription was not found.');
        if (
          new Date(input.expectedUpdatedAt).getTime() !==
          current.updatedAt.getTime()
        ) {
          throw new ApplicationError(
            ErrorCode.PlatformTenantConflict,
            'The subscription changed after it was loaded.',
            HttpStatus.CONFLICT,
          );
        }

        const now = new Date();
        const data = manualSubscriptionTransition(
          tenant.plan,
          current,
          input,
          now,
        );
        const updated = await transaction.tenantSubscription.update({
          where: { tenantId },
          data,
        });
        if (
          tenant.plan === 'TRIAL' &&
          data.currentPeriodEndsAt instanceof Date
        ) {
          await transaction.tenant.update({
            where: { id: tenantId },
            data: { trialEndsAt: data.currentPeriodEndsAt },
          });
        }
        await transaction.platformAuditEvent.create({
          data: {
            tenantId,
            operatorId: this.operatorId,
            eventType: `PLATFORM_SUBSCRIPTION_${input.action}`,
            outcome: 'SUCCESS',
            reason,
            correlationId: request.correlationId,
            ipAddress: request.ipAddress,
            userAgent: request.userAgent?.slice(0, 1024),
            metadata: {
              previous: subscriptionAuditState(current),
              next: subscriptionAuditState(updated),
            },
          },
        });
        return updated;
      },
    );
    return mapSubscriptionSummary(result);
  }

  async processBillingProviderEvent(
    tenantId: string,
    input: ProcessBillingProviderEventDto,
    request: RequestMetadata,
  ): Promise<BillingProviderEventReceiptDto> {
    const provider = input.provider.trim().toUpperCase();
    const providerEventId = input.providerEventId.trim();
    const occurredAt = new Date(input.occurredAt);
    const payloadHash = createHash('sha256')
      .update(stableStringify({ ...input, provider, providerEventId }))
      .digest('hex');

    return this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(
          hashtextextended(${`billing:${provider}:${providerEventId}`}, 0)
        )
      `;
      const duplicate = await transaction.billingProviderEvent.findUnique({
        where: { provider_providerEventId: { provider, providerEventId } },
      });
      if (duplicate) {
        if (duplicate.payloadHash.trim() !== payloadHash) {
          throw new ApplicationError(
            ErrorCode.BillingEventConflict,
            'The provider event identifier was already used with a different payload.',
            HttpStatus.CONFLICT,
          );
        }
        const subscription = await transaction.tenantSubscription.findUnique({
          where: { tenantId },
        });
        return {
          id: duplicate.id,
          status: duplicate.status,
          duplicate: true,
          subscription: subscription
            ? mapSubscriptionSummary(subscription)
            : null,
        };
      }

      await lockCommercialState(transaction, tenantId);
      const [tenant, current] = await Promise.all([
        transaction.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, plan: true },
        }),
        transaction.tenantSubscription.findUnique({ where: { tenantId } }),
      ]);
      if (!tenant) throw tenantNotFound();
      if (!current)
        throw invalidSubscription('The subscription was not found.');

      const stale = Boolean(
        current.lastProviderEventAt &&
        occurredAt.getTime() < current.lastProviderEventAt.getTime(),
      );
      let subscription = current;
      if (!stale) {
        const transition = providerSubscriptionTransition(
          tenant.plan,
          current,
          input,
          occurredAt,
        );
        subscription = await transaction.tenantSubscription.update({
          where: { tenantId },
          data: {
            ...transition,
            provider,
            providerCustomerId: input.providerCustomerId?.trim() ?? undefined,
            providerSubscriptionId:
              input.providerSubscriptionId?.trim() ?? undefined,
            lastProviderEventAt: occurredAt,
            lastProviderEventId: providerEventId,
          },
        });
        const providerPlan = input.plan ?? tenant.plan;
        const providerTrialEndsAt =
          providerPlan === 'TRIAL' &&
          transition.currentPeriodEndsAt instanceof Date
            ? transition.currentPeriodEndsAt
            : undefined;
        if ((input.plan && input.plan !== tenant.plan) || providerTrialEndsAt) {
          await transaction.tenant.update({
            where: { id: tenantId },
            data: {
              plan: input.plan,
              trialEndsAt: providerTrialEndsAt,
            },
          });
        }
      }

      const event = await transaction.billingProviderEvent.create({
        data: {
          tenantId,
          provider,
          providerEventId,
          eventType: input.eventType,
          status: stale ? 'IGNORED' : 'PROCESSED',
          payloadHash,
          occurredAt,
          correlationId: request.correlationId,
          metadata: {
            providerCustomerId: input.providerCustomerId ?? null,
            providerSubscriptionId: input.providerSubscriptionId ?? null,
            plan: input.plan ?? null,
            billingInterval: input.billingInterval ?? null,
            currentPeriodStartsAt: input.currentPeriodStartsAt ?? null,
            currentPeriodEndsAt: input.currentPeriodEndsAt ?? null,
            graceEndsAt: input.graceEndsAt ?? null,
            adapterMetadata: input.metadata ?? null,
          },
        },
      });
      await transaction.platformAuditEvent.create({
        data: {
          tenantId,
          operatorId: this.operatorId,
          eventType: stale
            ? 'BILLING_PROVIDER_EVENT_IGNORED'
            : 'BILLING_PROVIDER_EVENT_PROCESSED',
          outcome: 'SUCCESS',
          reason: stale
            ? 'Provider event was older than the last applied event.'
            : 'Normalized provider event applied to the subscription.',
          correlationId: request.correlationId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent?.slice(0, 1024),
          metadata: {
            provider,
            providerEventId,
            eventType: input.eventType,
            status: event.status,
          },
        },
      });
      return {
        id: event.id,
        status: event.status,
        duplicate: false,
        subscription: mapSubscriptionSummary(subscription),
      };
    });
  }

  async listAuditEvents(
    query: PlatformAuditEventQueryDto,
  ): Promise<PlatformAuditEventPageResponseDto> {
    let cursorPosition: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorPosition = await this.prisma.platformAuditEvent.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, id: true },
      });
      if (!cursorPosition) throw invalidTenant('The audit cursor is invalid.');
    }
    const records = await this.prisma.platformAuditEvent.findMany({
      where: {
        tenantId: query.tenantId,
        ...(cursorPosition
          ? {
              OR: [
                { createdAt: { lt: cursorPosition.createdAt } },
                {
                  createdAt: cursorPosition.createdAt,
                  id: { lt: cursorPosition.id },
                },
              ],
            }
          : {}),
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const page = hasMore ? records.slice(0, query.limit) : records;
    return {
      items: page.map((record) => ({
        id: record.id,
        tenant: record.tenant,
        operatorId: record.operatorId,
        eventType: record.eventType,
        outcome: record.outcome,
        reason: record.reason,
        correlationId: record.correlationId,
        metadata: record.metadata,
        createdAt: record.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async enrich(
    tenant: TenantSnapshot,
  ): Promise<PlatformTenantResponseDto> {
    const operational = await this.tenantUnitOfWork.execute(
      tenant.id,
      async (transaction) => {
        const [userGroups, commitments, usage] = await Promise.all([
          transaction.user.groupBy({
            by: ['status'],
            where: { tenantId: tenant.id },
            _count: { _all: true },
          }),
          readUserCommitments(transaction, tenant.id, new Date()),
          readStorageUsage(transaction, tenant.id),
        ]);
        const subscription = await transaction.tenantSubscription.findUnique({
          where: { tenantId: tenant.id },
        });
        return { userGroups, commitments, usage, subscription };
      },
    );
    const users: Record<UserStatus, number> = {
      ACTIVE: 0,
      INVITED: 0,
      LOCKED: 0,
      DISABLED: 0,
    };
    for (const group of operational.userGroups) {
      users[group.status] = group._count._all;
    }
    const quotaBytes = this.capacityPolicy.quotaFor(tenant.plan);
    return {
      ...tenant,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      users: {
        total: Object.values(users).reduce((sum, count) => sum + count, 0),
        active: users.ACTIVE,
        invited: users.INVITED,
        locked: users.LOCKED,
        disabled: users.DISABLED,
        pendingInvitations: operational.commitments.pendingInvitations,
      },
      photographicEvidence: {
        usedBytes: operational.usage.usedBytes,
        quotaBytes,
        photoCount: operational.usage.photoCount,
        usagePercent: Number(
          ((operational.usage.usedBytes / quotaBytes) * 100).toFixed(2),
        ),
        capacityStatus: this.capacityPolicy.statusFor(
          operational.usage.usedBytes,
          quotaBytes,
        ),
        counterAvailable: operational.usage.counterAvailable,
      },
      commercialEntitlements: this.commercialEntitlements.describe(
        { ...tenant, subscription: operational.subscription },
        operational.commitments.committedUsers,
      ),
      subscription: operational.subscription
        ? mapSubscriptionSummary(operational.subscription)
        : null,
    };
  }
}

const tenantSelection = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  trialEndsAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

async function readUserCommitments(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  now: Date,
): Promise<{ committedUsers: number; pendingInvitations: number }> {
  const [users, pendingInvitations] = await Promise.all([
    transaction.user.count({
      where: { tenantId, status: { not: 'DISABLED' } },
    }),
    transaction.invitation.count({
      where: { tenantId, status: 'PENDING', expiresAt: { gt: now } },
    }),
  ]);
  return {
    committedUsers: users + pendingInvitations,
    pendingInvitations,
  };
}

async function readStorageUsage(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<{
  usedBytes: number;
  photoCount: number;
  counterAvailable: boolean;
}> {
  const counter = await transaction.tenantPhotoEvidenceUsage.findUnique({
    where: { tenantId },
    select: { usedBytes: true, photoCount: true },
  });
  if (counter) {
    return {
      usedBytes: Number(counter.usedBytes),
      photoCount: counter.photoCount,
      counterAvailable: true,
    };
  }
  const actual = await transaction.photoEvidence.aggregate({
    where: { tenantId },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  return {
    usedBytes: Number(actual._sum.sizeBytes ?? 0),
    photoCount: actual._count._all,
    counterAvailable: false,
  };
}

function manualSubscriptionTransition(
  plan: TenantPlan,
  current: TenantSubscription,
  input: UpdatePlatformSubscriptionDto,
  now: Date,
): Prisma.TenantSubscriptionUncheckedUpdateInput {
  if (input.action === 'CANCEL_NOW') {
    return {
      status: 'CANCELED',
      cancelAtPeriodEnd: false,
      canceledAt: now,
      graceEndsAt: null,
    };
  }
  if (input.action === 'START_GRACE_PERIOD') {
    return {
      status: 'GRACE_PERIOD',
      graceEndsAt: futureDate(input.graceEndsAt, 'graceEndsAt', now),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    };
  }
  if (input.action === 'SCHEDULE_CANCELLATION') {
    const periodEnd = futureDate(
      input.currentPeriodEndsAt ?? current.currentPeriodEndsAt?.toISOString(),
      'currentPeriodEndsAt',
      now,
    );
    return {
      status: 'CANCEL_SCHEDULED',
      currentPeriodEndsAt: periodEnd,
      cancelAtPeriodEnd: true,
      graceEndsAt: null,
      canceledAt: null,
    };
  }

  const periodEnd = futureDate(
    input.currentPeriodEndsAt,
    'currentPeriodEndsAt',
    now,
  );
  const interval = plan === 'TRIAL' ? 'NONE' : input.billingInterval;
  if (plan !== 'TRIAL' && (!interval || interval === 'NONE')) {
    throw invalidSubscription(
      'A paid renewal requires a monthly, annual, or custom billing interval.',
    );
  }
  return {
    status: plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE',
    billingInterval: interval,
    currentPeriodStartsAt: now,
    currentPeriodEndsAt: periodEnd,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
  };
}

function providerSubscriptionTransition(
  tenantPlan: TenantPlan,
  current: TenantSubscription,
  input: ProcessBillingProviderEventDto,
  occurredAt: Date,
): Prisma.TenantSubscriptionUncheckedUpdateInput {
  const plan = input.plan ?? tenantPlan;
  if (input.eventType === 'SUBSCRIPTION_CANCELED') {
    return {
      status: 'CANCELED',
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      canceledAt: occurredAt,
    };
  }
  if (input.eventType === 'TRIAL_EXPIRED') {
    if (plan !== 'TRIAL') {
      throw invalidSubscription(
        'A trial expiration event can only be applied to a trial plan.',
      );
    }
    return {
      status: 'EXPIRED',
      billingInterval: 'NONE',
      currentPeriodEndsAt: occurredAt,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
    };
  }
  if (input.eventType === 'PAYMENT_FAILED') {
    return {
      status: 'GRACE_PERIOD',
      graceEndsAt: futureDate(input.graceEndsAt, 'graceEndsAt', occurredAt),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    };
  }
  if (input.eventType === 'CANCELLATION_SCHEDULED') {
    return {
      status: 'CANCEL_SCHEDULED',
      currentPeriodEndsAt: futureDate(
        input.currentPeriodEndsAt ?? current.currentPeriodEndsAt?.toISOString(),
        'currentPeriodEndsAt',
        occurredAt,
      ),
      graceEndsAt: null,
      cancelAtPeriodEnd: true,
      canceledAt: null,
    };
  }

  const periodEnd = futureDate(
    input.currentPeriodEndsAt,
    'currentPeriodEndsAt',
    occurredAt,
  );
  const interval = plan === 'TRIAL' ? 'NONE' : input.billingInterval;
  if (plan !== 'TRIAL' && (!interval || interval === 'NONE')) {
    throw invalidSubscription(
      'A paid provider event requires a billing interval.',
    );
  }
  return {
    status: plan === 'TRIAL' ? 'TRIALING' : 'ACTIVE',
    billingInterval: interval,
    currentPeriodStartsAt: input.currentPeriodStartsAt
      ? new Date(input.currentPeriodStartsAt)
      : occurredAt,
    currentPeriodEndsAt: periodEnd,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
  };
}

function futureDate(
  value: string | undefined,
  field: string,
  reference: Date,
): Date {
  if (!value) throw invalidSubscription(`${field} is required.`);
  const parsed = new Date(value);
  if (parsed.getTime() <= reference.getTime()) {
    throw invalidSubscription(`${field} must be in the future.`);
  }
  return parsed;
}

async function lockCommercialState(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:commercial-seat-allocation`}, 0)
    )
  `;
  const tenant = await transaction.$queryRaw<{ id: string }[]>`
    SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
  `;
  if (tenant.length !== 1) throw tenantNotFound();
  await transaction.$queryRaw`
    SELECT tenant_id
    FROM tenant_subscriptions
    WHERE tenant_id = ${tenantId}::uuid
    FOR UPDATE
  `;
}

function subscriptionAuditState(subscription: TenantSubscription): object {
  return {
    status: subscription.status,
    billingInterval: subscription.billingInterval,
    provider: subscription.provider,
    currentPeriodStartsAt:
      subscription.currentPeriodStartsAt?.toISOString() ?? null,
    currentPeriodEndsAt:
      subscription.currentPeriodEndsAt?.toISOString() ?? null,
    graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canceledAt: subscription.canceledAt?.toISOString() ?? null,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function batchesOf<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function tenantNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.PlatformTenantNotFound,
    'The organization was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function invalidTenant(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.PlatformTenantInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

function invalidSubscription(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.SubscriptionInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

import { HttpStatus, Injectable } from '@nestjs/common';
import type { TenantPlan } from '../../../generated/prisma/client.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import {
  subscriptionAllowsWrites,
  type SubscriptionSnapshot,
} from '../../subscriptions/application/subscription-lifecycle.js';

export const commercialModules = [
  'DOCUMENTS',
  'TRAINING',
  'DEVIATIONS',
  'CAPA',
  'CHANGE_CONTROL',
  'AUDITS',
  'QUALITY_RISKS',
  'SUPPLIERS',
  'EQUIPMENT',
  'COMPLAINTS',
  'RECALLS',
  'PRODUCT_REVIEWS',
  'PHOTO_EVIDENCE',
] as const;

export type CommercialModule = (typeof commercialModules)[number];
export type CommercialModuleAccess = 'FULL' | 'READ_ONLY';

export interface CommercialEntitlements {
  userLimit: number | null;
  committedUsers: number;
  remainingUserSeats: number | null;
  trialEndsAt: string | null;
  trialExpired: boolean;
  trialDaysRemaining: number | null;
  writeAccess: boolean;
  modules: { code: CommercialModule; access: CommercialModuleAccess }[];
}

export interface TenantCommercialState {
  plan: TenantPlan;
  trialEndsAt: Date | null;
  subscription?: Pick<
    SubscriptionSnapshot,
    'status' | 'currentPeriodEndsAt' | 'graceEndsAt'
  > | null;
}

const dayMilliseconds = 24 * 60 * 60 * 1000;
const allModules = new Set<CommercialModule>(commercialModules);
const starterModules = new Set<CommercialModule>([
  'DOCUMENTS',
  'TRAINING',
  'DEVIATIONS',
  'CAPA',
  'CHANGE_CONTROL',
  'PHOTO_EVIDENCE',
]);

const planDefinitions: Record<
  TenantPlan,
  { userLimit: number | null; modules: ReadonlySet<CommercialModule> }
> = {
  TRIAL: { userLimit: 5, modules: allModules },
  STARTER: { userLimit: 10, modules: starterModules },
  PROFESSIONAL: { userLimit: 50, modules: allModules },
  ENTERPRISE: { userLimit: null, modules: allModules },
};

const permissionModules: Readonly<Record<string, CommercialModule>> = {
  audit: 'AUDITS',
  audits: 'AUDITS',
  capas: 'CAPA',
  changes: 'CHANGE_CONTROL',
  complaints: 'COMPLAINTS',
  deviations: 'DEVIATIONS',
  documents: 'DOCUMENTS',
  equipment: 'EQUIPMENT',
  photo_evidence: 'PHOTO_EVIDENCE',
  product_reviews: 'PRODUCT_REVIEWS',
  recalls: 'RECALLS',
  risks: 'QUALITY_RISKS',
  suppliers: 'SUPPLIERS',
  training: 'TRAINING',
};

@Injectable()
export class CommercialEntitlementPolicy {
  trialEndsAt(startedAt: Date): Date {
    return new Date(startedAt.getTime() + 30 * dayMilliseconds);
  }

  userLimitFor(plan: TenantPlan): number | null {
    return planDefinitions[plan].userLimit;
  }

  describe(
    tenant: TenantCommercialState,
    committedUsers: number,
    now = new Date(),
  ): CommercialEntitlements {
    const trialExpired = this.isTrialExpired(tenant, now);
    const writeAccess =
      !trialExpired && this.subscriptionAllowsWrites(tenant, now);
    const definition = planDefinitions[tenant.plan];
    const remainingUserSeats =
      definition.userLimit === null
        ? null
        : Math.max(0, definition.userLimit - committedUsers);
    return {
      userLimit: definition.userLimit,
      committedUsers,
      remainingUserSeats,
      trialEndsAt:
        tenant.plan === 'TRIAL'
          ? (tenant.trialEndsAt?.toISOString() ?? null)
          : null,
      trialExpired,
      trialDaysRemaining:
        tenant.plan === 'TRIAL' && tenant.trialEndsAt
          ? Math.max(
              0,
              Math.ceil(
                (tenant.trialEndsAt.getTime() - now.getTime()) /
                  dayMilliseconds,
              ),
            )
          : null,
      writeAccess,
      modules: commercialModules.map((code) => ({
        code,
        access:
          writeAccess && definition.modules.has(code) ? 'FULL' : 'READ_ONLY',
      })),
    };
  }

  effectivePermissions(
    permissions: Iterable<string>,
    tenant: TenantCommercialState,
    now = new Date(),
  ): Set<string> {
    const definition = planDefinitions[tenant.plan];
    const trialExpired = this.isTrialExpired(tenant, now);
    const writeAccess =
      !trialExpired && this.subscriptionAllowsWrites(tenant, now);
    return new Set(
      [...permissions].filter((permission) => {
        if (isReadPermission(permission)) return true;
        if (!writeAccess) return false;
        const module = moduleForPermission(permission);
        return !module || definition.modules.has(module);
      }),
    );
  }

  restrictionFor(
    requiredPermissions: readonly string[],
    rawPermissions: ReadonlySet<string>,
    tenant: TenantCommercialState,
    now = new Date(),
  ): 'ROLE' | 'TRIAL' | 'SUBSCRIPTION' | 'MODULE' | null {
    if (
      requiredPermissions.some((permission) => !rawPermissions.has(permission))
    ) {
      return 'ROLE';
    }
    if (
      this.isTrialExpired(tenant, now) &&
      requiredPermissions.some((permission) => !isReadPermission(permission))
    ) {
      return 'TRIAL';
    }
    if (
      !this.subscriptionAllowsWrites(tenant, now) &&
      requiredPermissions.some((permission) => !isReadPermission(permission))
    ) {
      return 'SUBSCRIPTION';
    }
    const included = planDefinitions[tenant.plan].modules;
    if (
      requiredPermissions.some((permission) => {
        const module = moduleForPermission(permission);
        return module !== undefined && !included.has(module);
      })
    ) {
      return 'MODULE';
    }
    return null;
  }

  assertCanAllocateSeat(
    tenant: TenantCommercialState,
    committedUsers: number,
    options: { reservedSeat?: boolean; now?: Date } = {},
  ): void {
    if (this.isTrialExpired(tenant, options.now ?? new Date())) {
      throw trialExpired();
    }
    if (!this.subscriptionAllowsWrites(tenant, options.now ?? new Date())) {
      throw subscriptionInactive();
    }
    if (options.reservedSeat) return;
    const limit = this.userLimitFor(tenant.plan);
    const exceeds = limit !== null && committedUsers >= limit;
    if (exceeds) {
      throw new ApplicationError(
        ErrorCode.PlanUserLimitReached,
        'The organization has reached the user limit for its plan.',
        HttpStatus.CONFLICT,
        [{ plan: tenant.plan, userLimit: limit, committedUsers }],
      );
    }
  }

  private isTrialExpired(tenant: TenantCommercialState, now: Date): boolean {
    return (
      tenant.plan === 'TRIAL' &&
      (!tenant.trialEndsAt || tenant.trialEndsAt.getTime() <= now.getTime())
    );
  }

  private subscriptionAllowsWrites(
    tenant: TenantCommercialState,
    now: Date,
  ): boolean {
    return (
      !tenant.subscription || subscriptionAllowsWrites(tenant.subscription, now)
    );
  }
}

export function commercialRestrictionError(
  restriction: 'ROLE' | 'TRIAL' | 'SUBSCRIPTION' | 'MODULE',
  tenant: TenantCommercialState,
  requiredPermissions: readonly string[],
): ApplicationError {
  if (restriction === 'TRIAL') return trialExpired();
  if (restriction === 'SUBSCRIPTION') return subscriptionInactive();
  if (restriction === 'MODULE') {
    return new ApplicationError(
      ErrorCode.PlanFeatureNotAvailable,
      'The operation is not available in the organization plan.',
      HttpStatus.FORBIDDEN,
      [
        {
          plan: tenant.plan,
          modules: [
            ...new Set(
              requiredPermissions
                .map(moduleForPermission)
                .filter((value): value is CommercialModule => Boolean(value)),
            ),
          ],
        },
      ],
    );
  }
  return new ApplicationError(
    ErrorCode.Forbidden,
    'The operation is forbidden.',
    HttpStatus.FORBIDDEN,
  );
}

function moduleForPermission(permission: string): CommercialModule | undefined {
  return permissionModules[permission.split('.')[0] ?? ''];
}

function isReadPermission(permission: string): boolean {
  return (
    permission.endsWith('.read') ||
    permission.endsWith('.read_self') ||
    permission === 'capas.export'
  );
}

function trialExpired(): ApplicationError {
  return new ApplicationError(
    ErrorCode.TrialExpired,
    'The organization trial has expired. Records remain available in read-only mode.',
    HttpStatus.FORBIDDEN,
  );
}

function subscriptionInactive(): ApplicationError {
  return new ApplicationError(
    ErrorCode.SubscriptionInactive,
    'The organization subscription is inactive. Records remain available in read-only mode.',
    HttpStatus.FORBIDDEN,
  );
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantPlan } from '../../../generated/prisma/client.js';
import type { Environment } from '../../../common/config/environment.js';

export const photoEvidenceCapacityStatuses = [
  'NORMAL',
  'WARNING',
  'CRITICAL',
  'OVER_QUOTA',
] as const;

export type PhotoEvidenceCapacityStatus =
  (typeof photoEvidenceCapacityStatuses)[number];

@Injectable()
export class PhotoEvidenceCapacityPolicy {
  private readonly quotaBytesByPlan: Readonly<Record<TenantPlan, number>>;
  private readonly warningPercent: number;
  private readonly criticalPercent: number;

  constructor(config: ConfigService<Environment, true>) {
    this.quotaBytesByPlan = {
      TRIAL: config.getOrThrow('PHOTO_EVIDENCE_TENANT_QUOTA_BYTES', {
        infer: true,
      }),
      STARTER: config.getOrThrow('PHOTO_EVIDENCE_STARTER_QUOTA_BYTES', {
        infer: true,
      }),
      PROFESSIONAL: config.getOrThrow(
        'PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES',
        { infer: true },
      ),
      ENTERPRISE: config.getOrThrow('PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES', {
        infer: true,
      }),
    };
    this.warningPercent = config.getOrThrow(
      'PHOTO_EVIDENCE_CAPACITY_WARNING_PERCENT',
      { infer: true },
    );
    this.criticalPercent = config.getOrThrow(
      'PHOTO_EVIDENCE_CAPACITY_CRITICAL_PERCENT',
      { infer: true },
    );
  }

  quotaFor(plan: TenantPlan): number {
    return this.quotaBytesByPlan[plan];
  }

  statusFor(
    usedBytes: number,
    quotaBytes: number,
  ): PhotoEvidenceCapacityStatus {
    const usagePercent = (usedBytes / quotaBytes) * 100;
    if (usagePercent > 100) return 'OVER_QUOTA';
    if (usagePercent >= this.criticalPercent) return 'CRITICAL';
    if (usagePercent >= this.warningPercent) return 'WARNING';
    return 'NORMAL';
  }
}

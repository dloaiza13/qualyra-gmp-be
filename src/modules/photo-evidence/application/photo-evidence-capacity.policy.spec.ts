import { jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { PhotoEvidenceCapacityPolicy } from './photo-evidence-capacity.policy.js';

describe('PhotoEvidenceCapacityPolicy', () => {
  const policy = new PhotoEvidenceCapacityPolicy({
    getOrThrow: jest.fn((key: keyof Environment) => {
      const values: Partial<Record<keyof Environment, number>> = {
        PHOTO_EVIDENCE_TENANT_QUOTA_BYTES: 100,
        PHOTO_EVIDENCE_STARTER_QUOTA_BYTES: 200,
        PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES: 300,
        PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES: 400,
        PHOTO_EVIDENCE_CAPACITY_WARNING_PERCENT: 80,
        PHOTO_EVIDENCE_CAPACITY_CRITICAL_PERCENT: 95,
      };
      return values[key];
    }),
  } as unknown as ConfigService<Environment, true>);

  it('selects plan quotas and bounded operational states', () => {
    expect(policy.quotaFor('PROFESSIONAL')).toBe(300);
    expect(policy.statusFor(79, 100)).toBe('NORMAL');
    expect(policy.statusFor(80, 100)).toBe('WARNING');
    expect(policy.statusFor(95, 100)).toBe('CRITICAL');
    expect(policy.statusFor(101, 100)).toBe('OVER_QUOTA');
  });
});

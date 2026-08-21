import { ApiProperty } from '@nestjs/swagger';
import {
  TenantPlan,
  TenantStatus,
} from '../../../../generated/prisma/client.js';
import {
  photoEvidenceCapacityStatuses,
  type PhotoEvidenceCapacityStatus,
} from '../../../photo-evidence/application/photo-evidence-capacity.policy.js';
import { CommercialEntitlementsResponseDto } from '../../../commercial-entitlements/application/dto/commercial-entitlement-response.dto.js';

export class OrganizationUserUsageDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  pendingInvitations!: number;
}

export class OrganizationStorageUsageDto {
  @ApiProperty()
  usedBytes!: number;

  @ApiProperty()
  quotaBytes!: number;

  @ApiProperty()
  remainingBytes!: number;

  @ApiProperty()
  photoCount!: number;

  @ApiProperty()
  usagePercent!: number;

  @ApiProperty({ enum: photoEvidenceCapacityStatuses })
  capacityStatus!: PhotoEvidenceCapacityStatus;
}

export class OrganizationCommercialSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty({ enum: TenantPlan })
  plan!: TenantPlan;

  @ApiProperty({ type: OrganizationUserUsageDto })
  users!: OrganizationUserUsageDto;

  @ApiProperty({ type: OrganizationStorageUsageDto })
  photographicEvidence!: OrganizationStorageUsageDto;

  @ApiProperty({ enum: ['INVITATION_ONLY'] })
  membership!: 'INVITATION_ONLY';

  @ApiProperty({ enum: ['PROVIDER_MANAGED'] })
  commercialManagement!: 'PROVIDER_MANAGED';

  @ApiProperty({ type: CommercialEntitlementsResponseDto })
  commercialEntitlements!: CommercialEntitlementsResponseDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

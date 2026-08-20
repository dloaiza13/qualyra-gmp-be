import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TenantPlan,
  TenantStatus,
} from '../../../../generated/prisma/client.js';
import {
  photoEvidenceCapacityStatuses,
  type PhotoEvidenceCapacityStatus,
} from '../../../photo-evidence/application/photo-evidence-capacity.policy.js';

export class PlatformTenantUsersDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  invited!: number;

  @ApiProperty()
  locked!: number;

  @ApiProperty()
  disabled!: number;
}

export class PlatformTenantStorageDto {
  @ApiProperty()
  usedBytes!: number;

  @ApiProperty()
  quotaBytes!: number;

  @ApiProperty()
  photoCount!: number;

  @ApiProperty()
  usagePercent!: number;

  @ApiProperty({ enum: photoEvidenceCapacityStatuses })
  capacityStatus!: PhotoEvidenceCapacityStatus;

  @ApiProperty({
    description: 'Whether a maintained usage counter was available.',
  })
  counterAvailable!: boolean;
}

export class PlatformTenantResponseDto {
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

  @ApiProperty({ type: PlatformTenantUsersDto })
  users!: PlatformTenantUsersDto;

  @ApiProperty({ type: PlatformTenantStorageDto })
  photographicEvidence!: PlatformTenantStorageDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PlatformTenantPageResponseDto {
  @ApiProperty({ type: PlatformTenantResponseDto, isArray: true })
  items!: PlatformTenantResponseDto[];

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  nextCursor!: string | null;
}

export class PlatformAuditTenantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class PlatformAuditEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ nullable: true, type: PlatformAuditTenantDto })
  tenant!: PlatformAuditTenantDto | null;

  @ApiProperty()
  operatorId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ enum: ['SUCCESS', 'FAILURE'] })
  outcome!: 'SUCCESS' | 'FAILURE';

  @ApiProperty()
  reason!: string;

  @ApiProperty({ format: 'uuid' })
  correlationId!: string;

  @ApiProperty({ type: Object, nullable: true })
  metadata!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class PlatformAuditEventPageResponseDto {
  @ApiProperty({ type: PlatformAuditEventResponseDto, isArray: true })
  items!: PlatformAuditEventResponseDto[];

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  nextCursor!: string | null;
}

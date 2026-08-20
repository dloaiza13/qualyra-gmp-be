import { ApiProperty } from '@nestjs/swagger';
import {
  PhotoEvidenceSubjectType,
  TenantPlan,
} from '../../../../generated/prisma/client.js';
import {
  photoEvidenceCapacityStatuses,
  type PhotoEvidenceCapacityStatus,
} from '../photo-evidence-capacity.policy.js';

export class PhotoEvidenceUploaderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;
}

export class PhotoEvidenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PhotoEvidenceSubjectType })
  subjectType!: PhotoEvidenceSubjectType;

  @ApiProperty({ format: 'uuid' })
  subjectId!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty()
  sha256!: string;

  @ApiProperty({ nullable: true, type: String })
  caption!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  capturedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: PhotoEvidenceUploaderDto })
  uploadedBy!: PhotoEvidenceUploaderDto;

  @ApiProperty()
  contentUrl!: string;
}

export class PhotoEvidenceUsageResponseDto {
  @ApiProperty({ enum: TenantPlan })
  plan!: TenantPlan;

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

export class PhotoEvidencePageResponseDto {
  @ApiProperty({ type: PhotoEvidenceResponseDto, isArray: true })
  items!: PhotoEvidenceResponseDto[];

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  nextCursor!: string | null;
}

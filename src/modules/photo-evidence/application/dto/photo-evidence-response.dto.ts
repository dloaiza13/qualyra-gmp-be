import { ApiProperty } from '@nestjs/swagger';
import { PhotoEvidenceSubjectType } from '../../../../generated/prisma/client.js';

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
}

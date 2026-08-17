import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrainingUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class TrainingDocumentSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  status!: string;
}

export class TrainingDocumentVersionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ minimum: 1 })
  versionNumber!: number;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty()
  status!: string;
}

export class TrainingAssignmentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['ASSIGNED', 'COMPLETED', 'CANCELLED'] })
  status!: string;

  @ApiProperty({
    enum: ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'CANCELLED'],
  })
  dueState!: string;

  @ApiProperty({ format: 'date-time' })
  dueAt!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ type: TrainingUserSummaryDto })
  assignedTo!: TrainingUserSummaryDto;

  @ApiProperty({ type: TrainingUserSummaryDto })
  assignedBy!: TrainingUserSummaryDto;

  @ApiProperty({ type: TrainingDocumentSummaryDto })
  document!: TrainingDocumentSummaryDto;

  @ApiProperty({ type: TrainingDocumentVersionSummaryDto })
  documentVersion!: TrainingDocumentVersionSummaryDto;

  @ApiPropertyOptional({ enum: ['TRAINING_ACKNOWLEDGEMENT'], nullable: true })
  meaning!: string | null;

  @ApiPropertyOptional({ enum: ['PASSWORD_REAUTHENTICATION'], nullable: true })
  authenticationMethod!: string | null;

  @ApiPropertyOptional({ nullable: true })
  completionComment!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ type: TrainingUserSummaryDto, nullable: true })
  cancelledBy!: TrainingUserSummaryDto | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class TrainingAssignmentDetailResponseDto extends TrainingAssignmentSummaryResponseDto {
  @ApiProperty()
  content!: string;

  @ApiPropertyOptional({ pattern: '^[0-9a-f]{64}$', nullable: true })
  recordHash!: string | null;
}

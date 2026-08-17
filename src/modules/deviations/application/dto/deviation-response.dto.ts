import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeviationUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class DeviationSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'DEV-2026-0001' })
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  area!: string;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty({ enum: ['REPORTED', 'UNDER_INVESTIGATION', 'CANCELLED'] })
  status!: string;

  @ApiPropertyOptional({ enum: ['MINOR', 'MAJOR', 'CRITICAL'], nullable: true })
  severity!: string | null;

  @ApiProperty({
    enum: ['NOT_APPLICABLE', 'ON_TRACK', 'DUE_SOON', 'OVERDUE'],
  })
  dueState!: string;

  @ApiProperty({ type: DeviationUserSummaryDto })
  reportedBy!: DeviationUserSummaryDto;

  @ApiPropertyOptional({ type: DeviationUserSummaryDto, nullable: true })
  investigator!: DeviationUserSummaryDto | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  investigationDueAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class DeviationDetailResponseDto extends DeviationSummaryResponseDto {
  @ApiProperty()
  description!: string;

  @ApiPropertyOptional({ nullable: true })
  impactAssessment!: string | null;

  @ApiPropertyOptional({ nullable: true })
  containmentAction!: string | null;

  @ApiPropertyOptional({ type: DeviationUserSummaryDto, nullable: true })
  triagedBy!: DeviationUserSummaryDto | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  triagedAt!: string | null;

  @ApiPropertyOptional({ type: DeviationUserSummaryDto, nullable: true })
  cancelledBy!: DeviationUserSummaryDto | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationReason!: string | null;
}

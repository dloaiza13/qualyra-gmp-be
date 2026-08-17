import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeviationUserSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

export class DeviationInvestigationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['FIVE_WHYS', 'ISHIKAWA', 'FAULT_TREE_ANALYSIS', 'OTHER'],
  })
  method!: string;

  @ApiProperty()
  problemStatement!: string;

  @ApiProperty()
  chronology!: string;

  @ApiProperty()
  immediateCause!: string;

  @ApiProperty()
  rootCause!: string;

  @ApiProperty()
  contributingFactors!: string;

  @ApiProperty()
  productImpact!: string;

  @ApiProperty()
  requiresCapa!: boolean;

  @ApiProperty()
  capaRationale!: string;

  @ApiProperty({ type: DeviationUserSummaryDto })
  completedBy!: DeviationUserSummaryDto;

  @ApiProperty({ enum: ['INVESTIGATION_COMPLETION'] })
  meaning!: string;

  @ApiProperty({ enum: ['PASSWORD_REAUTHENTICATION'] })
  authenticationMethod!: string;

  @ApiProperty({ format: 'date-time' })
  completedAt!: string;

  @ApiProperty({ minLength: 64, maxLength: 64 })
  recordHash!: string;
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

  @ApiProperty({
    enum: [
      'REPORTED',
      'UNDER_INVESTIGATION',
      'INVESTIGATION_COMPLETED',
      'CANCELLED',
    ],
  })
  status!: string;

  @ApiPropertyOptional({ enum: ['MINOR', 'MAJOR', 'CRITICAL'], nullable: true })
  severity!: string | null;

  @ApiProperty({
    enum: ['NOT_APPLICABLE', 'ON_TRACK', 'DUE_SOON', 'OVERDUE', 'COMPLETED'],
  })
  dueState!: string;

  @ApiProperty({ type: DeviationUserSummaryDto })
  reportedBy!: DeviationUserSummaryDto;

  @ApiPropertyOptional({ type: DeviationUserSummaryDto, nullable: true })
  investigator!: DeviationUserSummaryDto | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  investigationDueAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  requiresCapa!: boolean | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  investigationCompletedAt!: string | null;

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

  @ApiPropertyOptional({
    type: DeviationInvestigationResponseDto,
    nullable: true,
  })
  investigation!: DeviationInvestigationResponseDto | null;
}

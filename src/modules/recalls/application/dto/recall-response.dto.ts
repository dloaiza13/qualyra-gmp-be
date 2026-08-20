import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecallUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class RecallParticipantResponseDto extends RecallUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class RecallComplaintReferenceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty() lotNumber!: string;
}

export class RecallReferencesResponseDto {
  @ApiProperty({ type: RecallComplaintReferenceDto, isArray: true })
  complaints!: RecallComplaintReferenceDto[];
}

export class RecallSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'RCL-2026-0001' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() actionType!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty({ type: String, isArray: true }) lotNumbers!: string[];
  @ApiProperty({ type: String, isArray: true }) countryCodes!: string[];
  @ApiProperty() status!: string;
  @ApiProperty() dueState!: string;
  @ApiProperty({ format: 'date-time' }) targetCloseAt!: string;
  @ApiPropertyOptional({ nullable: true }) classification!: string | null;
  @ApiPropertyOptional({ type: RecallUserSummaryDto, nullable: true })
  approver!: RecallUserSummaryDto | null;
  @ApiProperty() totalDistributedUnits!: number;
  @ApiProperty() recoveredUnits!: number;
  @ApiProperty() recoveryRate!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class RecallDetailResponseDto extends RecallSummaryResponseDto {
  @ApiProperty() sourceReference!: string;
  @ApiPropertyOptional({ type: Object, nullable: true })
  sourceComplaint!: Record<string, unknown> | null;
  @ApiProperty() reason!: string;
  @ApiPropertyOptional({ format: 'date', nullable: true })
  distributionStartDate!: string | null;
  @ApiPropertyOptional({ format: 'date', nullable: true })
  distributionEndDate!: string | null;
  @ApiProperty({ type: RecallUserSummaryDto })
  reportedBy!: RecallUserSummaryDto;
  @ApiPropertyOptional({ type: Object, nullable: true })
  riskAssessment!: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  decision!: Record<string, unknown> | null;
  @ApiProperty({ type: Object, isArray: true })
  executionUpdates!: Record<string, unknown>[];
  @ApiPropertyOptional({ type: Object, nullable: true })
  closure!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;
}

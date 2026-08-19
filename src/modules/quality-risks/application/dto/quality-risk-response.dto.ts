import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QualityRiskUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class QualityRiskParticipantResponseDto extends QualityRiskUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class QualityRiskItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() sequenceNumber!: number;
  @ApiProperty() failureMode!: string;
  @ApiProperty() cause!: string;
  @ApiProperty() effect!: string;
  @ApiProperty() currentControls!: string;
  @ApiProperty() initialSeverity!: number;
  @ApiProperty() initialProbability!: number;
  @ApiProperty() initialDetectability!: number;
  @ApiProperty() initialRpn!: number;
  @ApiProperty() initialLevel!: string;
  @ApiProperty() mitigationPlan!: string;
  @ApiProperty({ type: QualityRiskUserSummaryDto })
  assignedTo!: QualityRiskUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty() dueState!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ nullable: true }) completionEvidence!: string | null;
  @ApiPropertyOptional({ nullable: true }) residualSeverity!: number | null;
  @ApiPropertyOptional({ nullable: true }) residualProbability!: number | null;
  @ApiPropertyOptional({ nullable: true }) residualDetectability!:
    number | null;
  @ApiPropertyOptional({ nullable: true }) residualRpn!: number | null;
  @ApiPropertyOptional({ nullable: true }) residualLevel!: string | null;
  @ApiPropertyOptional({ type: QualityRiskUserSummaryDto, nullable: true })
  completedBy!: QualityRiskUserSummaryDto | null;
  @ApiPropertyOptional({ nullable: true }) meaning!: string | null;
  @ApiPropertyOptional({ nullable: true }) authenticationMethod!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) completedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) recordHash!: string | null;
}

export class QualityRiskSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'QRM-2026-0001' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() category!: string;
  @ApiProperty() method!: string;
  @ApiProperty() processArea!: string;
  @ApiProperty() status!: string;
  @ApiProperty() dueState!: string;
  @ApiProperty({ type: QualityRiskUserSummaryDto })
  owner!: QualityRiskUserSummaryDto;
  @ApiProperty({ type: QualityRiskUserSummaryDto })
  reviewer!: QualityRiskUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) targetReviewAt!: string;
  @ApiProperty() highestInitialRpn!: number;
  @ApiPropertyOptional({ nullable: true }) highestResidualRpn!: number | null;
  @ApiProperty() openItemCount!: number;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class QualityRiskDetailResponseDto extends QualityRiskSummaryResponseDto {
  @ApiProperty() scope!: string;
  @ApiProperty() riskStatement!: string;
  @ApiProperty({ type: QualityRiskUserSummaryDto })
  createdBy!: QualityRiskUserSummaryDto;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) deviationId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) capaId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) changeControlId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) auditId!:
    string | null;
  @ApiProperty({ type: QualityRiskItemResponseDto, isArray: true })
  items!: QualityRiskItemResponseDto[];
  @ApiPropertyOptional({ nullable: true }) review!: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) cancelledAt!:
    string | null;
}

export class QualityRiskReferencesResponseDto {
  @ApiProperty({ type: Object, isArray: true }) deviations!: Record<
    string,
    string
  >[];
  @ApiProperty({ type: Object, isArray: true }) capas!: Record<
    string,
    string
  >[];
  @ApiProperty({ type: Object, isArray: true }) changeControls!: Record<
    string,
    string
  >[];
  @ApiProperty({ type: Object, isArray: true }) audits!: Record<
    string,
    string
  >[];
}

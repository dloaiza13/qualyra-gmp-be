import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChangeControlUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class ChangeControlParticipantResponseDto extends ChangeControlUserSummaryDto {
  @ApiProperty({ type: String, isArray: true })
  permissions!: string[];
}

export class ChangeControlTaskResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  assignedTo!: ChangeControlUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ enum: ['OPEN', 'COMPLETED'] }) status!: string;
  @ApiProperty({ enum: ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'COMPLETED'] })
  dueState!: string;
  @ApiPropertyOptional({ nullable: true }) completionComment!: string | null;
  @ApiPropertyOptional({ nullable: true }) meaning!: string | null;
  @ApiPropertyOptional({ nullable: true }) authenticationMethod!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) recordHash!: string | null;
}

export class ChangeControlAssessmentResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() impactSummary!: string;
  @ApiProperty() qualityImpact!: string;
  @ApiProperty() regulatoryImpact!: string;
  @ApiProperty() validationImpact!: string;
  @ApiProperty() trainingImpact!: string;
  @ApiProperty() documentImpact!: string;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  riskLevel!: string;
  @ApiProperty() riskRationale!: string;
  @ApiProperty() implementationPlan!: string;
  @ApiProperty() rollbackPlan!: string;
  @ApiProperty() verificationCriterion!: string;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  assessedBy!: ChangeControlUserSummaryDto;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  owner!: ChangeControlUserSummaryDto;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  approver!: ChangeControlUserSummaryDto;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  verifier!: ChangeControlUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) assessedAt!: string;
}

export class ChangeControlDecisionResponseDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) decision!: string;
  @ApiProperty() comment!: string;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  decidedBy!: ChangeControlUserSummaryDto;
  @ApiProperty() meaning!: string;
  @ApiProperty() authenticationMethod!: string;
  @ApiProperty({ format: 'date-time' }) decidedAt!: string;
  @ApiProperty() recordHash!: string;
}

export class ChangeControlVerificationResponseDto {
  @ApiProperty({ enum: ['EFFECTIVE', 'INEFFECTIVE'] }) decision!: string;
  @ApiProperty() evidence!: string;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  verifiedBy!: ChangeControlUserSummaryDto;
  @ApiProperty() meaning!: string;
  @ApiProperty() authenticationMethod!: string;
  @ApiProperty({ format: 'date-time' }) verifiedAt!: string;
  @ApiProperty() recordHash!: string;
}

export class ChangeControlSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'CC-2026-0001' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() category!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ enum: ['ON_TRACK', 'DUE_SOON', 'OVERDUE', 'COMPLETED'] })
  dueState!: string;
  @ApiProperty({ type: ChangeControlUserSummaryDto })
  proposedBy!: ChangeControlUserSummaryDto;
  @ApiPropertyOptional({ nullable: true }) riskLevel!: string | null;
  @ApiProperty({ format: 'date-time' }) targetCompletionAt!: string;
  @ApiProperty() openTaskCount!: number;
  @ApiProperty() totalTaskCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ChangeControlDetailResponseDto extends ChangeControlSummaryResponseDto {
  @ApiProperty() description!: string;
  @ApiProperty() justification!: string;
  @ApiPropertyOptional({
    type: ChangeControlAssessmentResponseDto,
    nullable: true,
  })
  assessment!: ChangeControlAssessmentResponseDto | null;
  @ApiPropertyOptional({
    type: ChangeControlDecisionResponseDto,
    nullable: true,
  })
  decision!: ChangeControlDecisionResponseDto | null;
  @ApiProperty({ type: ChangeControlTaskResponseDto, isArray: true })
  tasks!: ChangeControlTaskResponseDto[];
  @ApiPropertyOptional({
    type: ChangeControlVerificationResponseDto,
    nullable: true,
  })
  verification!: ChangeControlVerificationResponseDto | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;
}

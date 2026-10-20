import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ComplianceReadinessPolicyValues,
  ComplianceReadinessResult,
} from '../../domain/compliance-readiness.js';

export class ComplianceUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class ComplianceSourceLocationResponseDto {
  @ApiProperty() modulePath!: string;
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty() permission!: string;
}

export class ComplianceRequirementResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  parentRequirementId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() severity!: string;
  @ApiProperty() weight!: number;
  @ApiProperty() mandatory!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class ComplianceFrameworkResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() version!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ nullable: true }) jurisdiction!: string | null;
  @ApiPropertyOptional({ format: 'date', nullable: true }) effectiveDate!:
    string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: ComplianceRequirementResponseDto, isArray: true })
  requirements!: ComplianceRequirementResponseDto[];
}

export class ComplianceControlResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() category!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ type: ComplianceUserSummaryDto, nullable: true })
  owner!: ComplianceUserSummaryDto | null;
  @ApiProperty({ type: ComplianceRequirementResponseDto, isArray: true })
  requirements!: ComplianceRequirementResponseDto[];
  @ApiProperty() evidenceCount!: number;
}

export class ComplianceEvidenceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) requirementId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) controlId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) findingId!:
    string | null;
  @ApiProperty() sourceEntityType!: string;
  @ApiProperty({ format: 'uuid' }) sourceEntityId!: string;
  @ApiProperty() sourceReference!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ format: 'date', nullable: true }) validUntil!:
    string | null;
  @ApiProperty({ type: ComplianceUserSummaryDto })
  createdBy!: ComplianceUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ComplianceFindingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() severity!: string;
  @ApiProperty() status!: string;
  @ApiProperty() category!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() detectionSource!: string;
  @ApiPropertyOptional() sourceEntityType!: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) sourceEntityId!: string | null;
  @ApiPropertyOptional() sourceReference!: string | null;
  @ApiPropertyOptional({ format: 'uuid' }) ruleId!: string | null;
  @ApiPropertyOptional({ format: 'date-time' }) lastEvaluatedAt!: string | null;
  @ApiProperty({ type: Object }) framework!: {
    id: string;
    code: string;
    name: string;
    version: string;
  };
  @ApiProperty({ type: Object }) requirement!: {
    id: string;
    code: string;
    title: string;
  };
  @ApiPropertyOptional({ type: Object, nullable: true }) control!: {
    id: string;
    code: string;
    name: string;
  } | null;
  @ApiPropertyOptional({ type: ComplianceUserSummaryDto, nullable: true })
  owner!: ComplianceUserSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) detectedAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) dueAt!:
    string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) resolvedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) resolutionNote!: string | null;
  @ApiProperty() evidenceCount!: number;
}

export class ComplianceOverviewResponseDto {
  @ApiProperty() frameworks!: number;
  @ApiProperty() requirements!: number;
  @ApiProperty() controls!: number;
  @ApiProperty() evidence!: number;
  @ApiProperty() openFindings!: number;
  @ApiProperty() criticalFindings!: number;
  @ApiProperty() majorFindings!: number;
  @ApiProperty() unmappedRequirements!: number;
}

export class ComplianceRuleConfigurationFieldResponseDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ['INTEGER'] }) type!: 'INTEGER';
  @ApiProperty() minimum!: number;
  @ApiProperty() maximum!: number;
  @ApiProperty() defaultValue!: number;
}

export class ComplianceRuleCatalogResponseDto {
  @ApiProperty() implementationKey!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() sourceEntityType!: string;
  @ApiProperty() defaultCategory!: string;
  @ApiProperty() defaultSeverity!: string;
  @ApiProperty({
    type: ComplianceRuleConfigurationFieldResponseDto,
    isArray: true,
  })
  configurationFields!: readonly ComplianceRuleConfigurationFieldResponseDto[];
}

export class ComplianceRuleResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() implementationKey!: string;
  @ApiProperty() category!: string;
  @ApiProperty() severity!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: Object }) configuration!: Record<string, unknown>;
  @ApiProperty({ type: Object }) framework!: {
    id: string;
    code: string;
    name: string;
    version: string;
    active: boolean;
  };
  @ApiProperty({ type: Object }) requirement!: {
    id: string;
    code: string;
    title: string;
  };
  @ApiPropertyOptional({ type: Object, nullable: true }) control!: {
    id: string;
    code: string;
    name: string;
  } | null;
  @ApiPropertyOptional({ type: ComplianceUserSummaryDto, nullable: true })
  owner!: ComplianceUserSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ComplianceRuleResultResponseDto {
  @ApiProperty({ type: Object }) ruleSnapshot!: Record<string, unknown>;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() outcome!: string;
  @ApiProperty() scannedCount!: number;
  @ApiProperty() violationCount!: number;
  @ApiProperty() findingsCreated!: number;
  @ApiProperty() findingsReopened!: number;
  @ApiProperty() findingsResolved!: number;
  @ApiProperty() findingsUnchanged!: number;
  @ApiPropertyOptional() errorMessage!: string | null;
  @ApiProperty({ type: Object }) rule!: {
    id: string;
    key: string;
    name: string;
  };
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ format: 'date-time' }) completedAt!: string;
}

export class ComplianceEvaluationRunResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() trigger!: string;
  @ApiProperty({ type: ComplianceUserSummaryDto })
  triggeredBy!: ComplianceUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiPropertyOptional({ format: 'date-time' }) completedAt!: string | null;
  @ApiProperty() rulesEvaluated!: number;
  @ApiProperty() violationsDetected!: number;
  @ApiProperty() findingsCreated!: number;
  @ApiProperty() findingsReopened!: number;
  @ApiProperty() findingsResolved!: number;
  @ApiProperty() findingsUnchanged!: number;
  @ApiPropertyOptional() errorSummary!: string | null;
  @ApiProperty({ type: ComplianceRuleResultResponseDto, isArray: true })
  results!: ComplianceRuleResultResponseDto[];
}

export class ComplianceReadinessPolicyResponseDto implements ComplianceReadinessPolicyValues {
  @ApiProperty() version!: number;
  @ApiProperty() criticalPenalty!: number;
  @ApiProperty() majorPenalty!: number;
  @ApiProperty() minorPenalty!: number;
  @ApiProperty() observationPenalty!: number;
  @ApiProperty() unmappedRequirementPenalty!: number;
  @ApiProperty() missingEvidencePenalty!: number;
  @ApiProperty() excellentMinimum!: number;
  @ApiProperty() goodMinimum!: number;
  @ApiProperty() needsAttentionMinimum!: number;
  @ApiProperty({ type: Object }) frameworkWeights!: Record<string, number>;
  @ApiProperty({ type: Object }) categoryWeights!: Record<string, number>;
}

export class ComplianceReadinessResponseDto implements ComplianceReadinessResult {
  @ApiProperty({ format: 'date-time' }) calculatedAt!: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 100, nullable: true })
  overallScore!: number | null;
  @ApiProperty() status!: ComplianceReadinessResult['status'];
  @ApiProperty() eligible!: boolean;
  @ApiProperty({ type: Object })
  methodology!: ComplianceReadinessResult['methodology'];
  @ApiProperty({ type: Object })
  coverage!: ComplianceReadinessResult['coverage'];
  @ApiProperty({ type: Object })
  findings!: ComplianceReadinessResult['findings'];
  @ApiProperty({ type: Object, isArray: true })
  frameworks!: ComplianceReadinessResult['frameworks'];
  @ApiProperty({ type: Object, isArray: true })
  categories!: ComplianceReadinessResult['categories'];
  @ApiProperty({ type: Object, isArray: true })
  deductions!: ComplianceReadinessResult['deductions'];
}

export class ComplianceScoreSnapshotResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 100, nullable: true })
  overallScore!: number | null;
  @ApiProperty() status!: ComplianceReadinessResult['status'];
  @ApiProperty() activeFrameworks!: number;
  @ApiProperty() totalRequirements!: number;
  @ApiProperty() mappedRequirements!: number;
  @ApiProperty() evidenceCoveredRequirements!: number;
  @ApiProperty() criticalFindings!: number;
  @ApiProperty() majorFindings!: number;
  @ApiProperty() minorFindings!: number;
  @ApiProperty() observationFindings!: number;
  @ApiProperty() acceptedRiskFindings!: number;
  @ApiProperty() policyVersion!: number;
  @ApiProperty({ type: Object, isArray: true })
  frameworks!: ComplianceReadinessResult['frameworks'];
  @ApiProperty({ type: Object, isArray: true })
  categories!: ComplianceReadinessResult['categories'];
  @ApiProperty({ type: ComplianceUserSummaryDto })
  createdBy!: ComplianceUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

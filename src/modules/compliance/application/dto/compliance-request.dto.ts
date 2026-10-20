import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  Matches,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { complianceEvidenceSourceTypes } from '../../domain/compliance-evidence-source.js';
import { complianceRuleImplementationKeys } from '../../domain/compliance-rule.js';

export const complianceRequirementSeverities = [
  'CRITICAL',
  'MAJOR',
  'MINOR',
  'OBSERVATION',
] as const;
export const complianceControlStatuses = [
  'DRAFT',
  'ACTIVE',
  'RETIRED',
] as const;
export const complianceFindingSeverities = complianceRequirementSeverities;
export const complianceFindingStatuses = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'ACCEPTED_RISK',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateComplianceFrameworkDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 80)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  name!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  version!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  description!: string;
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(2, 120)
  jurisdiction?: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveDate?: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active =
    true;
}

export class UpdateComplianceFrameworkDto {
  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

export class CreateComplianceRequirementDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  parentRequirementId?: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 300)
  title!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  description!: string;
  @ApiProperty({ enum: complianceRequirementSeverities })
  @IsIn(complianceRequirementSeverities)
  severity!: (typeof complianceRequirementSeverities)[number];
  @ApiPropertyOptional({ minimum: 0.01, maximum: 100, default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  weight = 1;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() mandatory =
    true;
  @ApiPropertyOptional({ minimum: 0, maximum: 100000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder = 0;
}

export class CreateComplianceControlDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 80)
  code!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 250)
  name!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  description!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  category!: string;
  @ApiPropertyOptional({ enum: complianceControlStatuses, default: 'DRAFT' })
  @IsOptional()
  @IsIn(complianceControlStatuses)
  status: (typeof complianceControlStatuses)[number] = 'DRAFT';
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  ownerUserId?: string;
  @ApiProperty({ type: String, isArray: true, minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  requirementIds!: string[];
}

export class UpdateComplianceControlDto extends PartialType(
  OmitType(CreateComplianceControlDto, ['status', 'ownerUserId'] as const),
) {
  @ApiPropertyOptional({ enum: complianceControlStatuses })
  @IsOptional()
  @IsIn(complianceControlStatuses)
  status?: (typeof complianceControlStatuses)[number];

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  ownerUserId?: string | null;
}

export class ComplianceEvidenceListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 200 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 200;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000000, default: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset = 0;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  findingId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  requirementId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  controlId?: string;
}

export class ComplianceSourceParamsDto {
  @ApiProperty({ enum: complianceEvidenceSourceTypes })
  @IsIn(complianceEvidenceSourceTypes)
  sourceType!: (typeof complianceEvidenceSourceTypes)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sourceId!: string;
}

export class CreateComplianceEvidenceDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  requirementId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  controlId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  findingId?: string;
  @ApiProperty({ enum: complianceEvidenceSourceTypes })
  @IsIn(complianceEvidenceSourceTypes)
  sourceEntityType!: (typeof complianceEvidenceSourceTypes)[number];
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') sourceEntityId!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 300)
  sourceReference!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 3000)
  description!: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string;
}

export class CreateComplianceFindingDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') requirementId!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  controlId?: string;
  @ApiProperty({ enum: complianceFindingSeverities })
  @IsIn(complianceFindingSeverities)
  severity!: (typeof complianceFindingSeverities)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  category!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 300)
  title!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  description!: string;
  @ApiPropertyOptional({ default: 'MANUAL' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(2, 80)
  detectionSource = 'MANUAL';
  @ApiPropertyOptional({ enum: complianceEvidenceSourceTypes })
  @IsOptional()
  @IsIn(complianceEvidenceSourceTypes)
  sourceEntityType?: (typeof complianceEvidenceSourceTypes)[number];
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  sourceEntityId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  ownerUserId?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;
}

export class UpdateComplianceFindingStatusDto {
  @ApiProperty({ enum: complianceFindingStatuses })
  @IsIn(complianceFindingStatuses)
  status!: (typeof complianceFindingStatuses)[number];
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(5, 3000)
  resolutionNote?: string;
}

export class ComplianceFindingListQueryDto {
  @ApiPropertyOptional({ enum: complianceFindingSeverities })
  @IsOptional()
  @IsIn(complianceFindingSeverities)
  severity?: (typeof complianceFindingSeverities)[number];
  @ApiPropertyOptional({ enum: complianceFindingStatuses })
  @IsOptional()
  @IsIn(complianceFindingStatuses)
  status?: (typeof complianceFindingStatuses)[number];
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  frameworkId?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000000, default: 0 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  offset = 0;
}

export class CreateComplianceRuleDto {
  @ApiProperty({ example: 'CAPA-ACTION-OVERDUE' })
  @Transform(trimString)
  @IsString()
  @Length(3, 60)
  @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
  key!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  name!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  description!: string;

  @ApiProperty({ enum: complianceRuleImplementationKeys })
  @IsIn(complianceRuleImplementationKeys)
  implementationKey!: (typeof complianceRuleImplementationKeys)[number];

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  category!: string;

  @ApiProperty({ enum: complianceFindingSeverities })
  @IsIn(complianceFindingSeverities)
  severity!: (typeof complianceFindingSeverities)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  requirementId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  controlId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  ownerUserId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled = true;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class UpdateComplianceRuleDto {
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(5, 200)
  name?: string;

  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(10, 3000)
  description?: string;

  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(2, 100)
  category?: string;

  @ApiPropertyOptional({ enum: complianceFindingSeverities })
  @IsOptional()
  @IsIn(complianceFindingSeverities)
  severity?: (typeof complianceFindingSeverities)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class RunComplianceEvaluationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  idempotencyKey!: string;

  @ApiPropertyOptional({ type: String, isArray: true, maxItems: 100 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ruleIds?: string[];
}

export class ComplianceEvaluationListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class UpdateComplianceReadinessPolicyDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  criticalPenalty?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  majorPenalty?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  minorPenalty?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  observationPenalty?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  unmappedRequirementPenalty?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  missingEvidencePenalty?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  excellentMinimum?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  goodMinimum?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  needsAttentionMinimum?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  frameworkWeights?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  categoryWeights?: Record<string, unknown>;
}

export class ComplianceSnapshotListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 24 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 24;
}

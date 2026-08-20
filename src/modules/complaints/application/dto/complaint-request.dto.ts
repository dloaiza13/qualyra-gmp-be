import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const complaintSources = [
  'CUSTOMER',
  'DISTRIBUTOR',
  'HEALTH_AUTHORITY',
  'INTERNAL',
  'OTHER',
] as const;
export const complaintCategories = [
  'PRODUCT_QUALITY',
  'PACKAGING',
  'LABELING',
  'DELIVERY',
  'COUNTERFEIT_SUSPECTED',
  'OTHER',
] as const;
export const complaintStatuses = [
  'REPORTED',
  'UNDER_INVESTIGATION',
  'PENDING_REVIEW',
  'CLOSED',
  'CANCELLED',
] as const;
export const complaintSeverities = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export const regulatoryAssessments = [
  'UNDER_EVALUATION',
  'NOT_REPORTABLE',
  'REPORTABLE',
] as const;
export const complaintDispositions = [
  'SUBSTANTIATED',
  'UNSUBSTANTIATED',
  'INCONCLUSIVE',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function upperString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class CreateComplaintDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  title!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  description!: string;
  @ApiProperty({ enum: complaintSources })
  @IsIn(complaintSources)
  source!: (typeof complaintSources)[number];
  @ApiProperty({ enum: complaintCategories })
  @IsIn(complaintCategories)
  category!: (typeof complaintCategories)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  productName!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  productCode!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  lotNumber!: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsISO8601({ strict: true })
  expiryDate?: string;
  @ApiProperty({ example: 'GT' })
  @Transform(upperString)
  @Matches(/^[A-Z]{2}$/)
  countryCode!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  receivedAt!: string;
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(2, 200)
  reporterName?: string;
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(320)
  reporterContact?: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 2000)
  evidenceReference!: string;
  @ApiProperty() @IsBoolean() potentialSafetyEvent!: boolean;
}

export class TriageComplaintDto {
  @ApiProperty({ enum: complaintSeverities })
  @IsIn(complaintSeverities)
  severity!: (typeof complaintSeverities)[number];
  @ApiProperty({ enum: regulatoryAssessments })
  @IsIn(regulatoryAssessments)
  regulatoryAssessment!: (typeof regulatoryAssessments)[number];
  @ApiProperty() @IsBoolean() recallAssessmentRequired!: boolean;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  immediateActions!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  targetCloseAt!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') investigatorUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') reviewerUserId!: string;
}

export class CompleteComplaintInvestigationDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  investigationSummary!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rootCause!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  batchImpact!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  distributedProductImpact!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  sampleEvaluation!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 3000)
  evidenceReference!: string;
  @ApiProperty({ enum: complaintDispositions })
  @IsIn(complaintDispositions)
  recommendedDisposition!: (typeof complaintDispositions)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  responseRecommendation!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  deviationId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  capaId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  supplierId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  qualityRiskId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  changeControlId?: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class DecideComplaintDto {
  @ApiProperty({ enum: complaintDispositions })
  @IsIn(complaintDispositions)
  disposition!: (typeof complaintDispositions)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rationale!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 2000)
  finalResponseReference!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 3000)
  regulatoryAction!: string;
  @ApiProperty() @IsBoolean() recallActionRequired!: boolean;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class CancelComplaintDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class ComplaintListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
  @ApiPropertyOptional({ enum: complaintStatuses })
  @IsOptional()
  @IsIn(complaintStatuses)
  status?: (typeof complaintStatuses)[number];
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const qualityRiskCategories = [
  'PRODUCT',
  'PROCESS',
  'EQUIPMENT',
  'COMPUTERIZED_SYSTEM',
  'SUPPLIER',
  'FACILITY',
  'OTHER',
] as const;
export const qualityRiskStatuses = [
  'OPEN',
  'PENDING_REVIEW',
  'CLOSED',
  'RESIDUAL_RISK_NOT_ACCEPTED',
  'CANCELLED',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateQualityRiskItemDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  failureMode!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  cause!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  effect!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  currentControls!: string;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  initialSeverity!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  initialProbability!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  initialDetectability!: number;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  mitigationPlan!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') assignedToUserId!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;
}

export class CreateQualityRiskDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  title!: string;
  @ApiProperty({ enum: qualityRiskCategories })
  @IsIn(qualityRiskCategories)
  category!: (typeof qualityRiskCategories)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 120)
  processArea!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  scope!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  riskStatement!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') ownerUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') reviewerUserId!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  targetReviewAt!: string;
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
  changeControlId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  auditId?: string;
  @ApiProperty({ type: CreateQualityRiskItemDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => CreateQualityRiskItemDto)
  items!: CreateQualityRiskItemDto[];
}

export class CompleteQualityRiskItemDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  completionEvidence!: string;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  residualSeverity!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  residualProbability!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  residualDetectability!: number;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class ReviewQualityRiskDto {
  @ApiProperty({ enum: ['ACCEPT', 'NOT_ACCEPTABLE'] })
  @IsIn(['ACCEPT', 'NOT_ACCEPTABLE'])
  decision!: 'ACCEPT' | 'NOT_ACCEPTABLE';
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rationale!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class CancelQualityRiskDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class QualityRiskListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
  @ApiPropertyOptional({ enum: qualityRiskStatuses })
  @IsOptional()
  @IsIn(qualityRiskStatuses)
  status?: (typeof qualityRiskStatuses)[number];
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

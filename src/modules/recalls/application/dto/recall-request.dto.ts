import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
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

export const recallActionTypes = [
  'RECALL',
  'MARKET_WITHDRAWAL',
  'FIELD_CORRECTION',
  'SAFETY_NOTICE',
  'STOCK_RECOVERY',
] as const;
export const recallStatuses = [
  'REPORTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'IN_EXECUTION',
  'CLOSED',
  'CANCELLED',
] as const;
export const recallClassifications = [
  'CLASS_I',
  'CLASS_II',
  'CLASS_III',
  'UNCLASSIFIED',
] as const;
export const recallDepths = [
  'CONSUMER',
  'RETAIL',
  'WHOLESALE',
  'INTERNAL',
] as const;
export const recallUpdateTypes = [
  'EXECUTION_STARTED',
  'ACCOUNT_NOTIFICATION',
  'PRODUCT_RECOVERY',
  'PRODUCT_DESTRUCTION',
  'REGULATORY_COMMUNICATION',
  'OTHER',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function trimStringArray({ value }: TransformFnParams): unknown {
  if (!Array.isArray(value)) return value as unknown;
  return (value as unknown[]).map((item) =>
    typeof item === 'string' ? item.trim() : item,
  );
}

function upperStringArray({ value }: TransformFnParams): unknown {
  if (!Array.isArray(value)) return value as unknown;
  return (value as unknown[]).map((item) =>
    typeof item === 'string' ? item.trim().toUpperCase() : item,
  );
}

export class CreateRecallDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  title!: string;

  @ApiProperty({ enum: recallActionTypes })
  @IsIn(recallActionTypes)
  actionType!: (typeof recallActionTypes)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  sourceComplaintId?: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 1000)
  sourceReference!: string;

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

  @ApiProperty({ type: String, isArray: true })
  @Transform(trimStringArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  lotNumbers!: string[];

  @ApiProperty({ type: String, isArray: true, example: ['GT', 'CR'] })
  @Transform(upperStringArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Matches(/^[A-Z]{2}$/, { each: true })
  countryCodes!: string[];

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  reason!: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsISO8601({ strict: true })
  distributionStartDate?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsISO8601({ strict: true })
  distributionEndDate?: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  totalDistributedUnits!: number;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  targetCloseAt!: string;
}

export class CompleteRecallAssessmentDto {
  @ApiProperty({ enum: recallClassifications })
  @IsIn(recallClassifications)
  classification!: (typeof recallClassifications)[number];

  @ApiProperty({ enum: recallDepths })
  @IsIn(recallDepths)
  depth!: (typeof recallDepths)[number];

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  healthHazard!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  scopeRationale!: string;

  @ApiProperty()
  @IsBoolean()
  regulatoryReportingRequired!: boolean;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  communicationPlan!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  recommendedAction!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  approverUserId!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class DecideRecallDto {
  @ApiProperty()
  @IsBoolean()
  approved!: boolean;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rationale!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 2000)
  authorityReference!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class RecordRecallExecutionUpdateDto {
  @ApiProperty({ enum: recallUpdateTypes })
  @IsIn(recallUpdateTypes)
  updateType!: (typeof recallUpdateTypes)[number];

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 3000)
  note!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 2000)
  evidenceReference!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cumulativeNotifiedAccounts!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cumulativeRespondingAccounts!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cumulativeRecoveredUnits!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cumulativeDestroyedUnits!: number;
}

export class CloseRecallDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  effectivenessSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  reconciliationSummary!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalNotifiedAccounts!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalRespondingAccounts!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalRecoveredUnits!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalDestroyedUnits!: number;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 3000)
  dispositionEvidence!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 2000)
  regulatoryClosureReference!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class CancelRecallDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class RecallListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ enum: recallStatuses })
  @IsOptional()
  @IsIn(recallStatuses)
  status?: (typeof recallStatuses)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

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

export const changeControlStatuses = [
  'PROPOSED',
  'ASSESSED',
  'APPROVED',
  'IMPLEMENTING',
  'PENDING_VERIFICATION',
  'CLOSED',
  'REJECTED',
  'VERIFICATION_FAILED',
  'CANCELLED',
] as const;
export const changeControlCategories = [
  'DOCUMENT',
  'PROCESS',
  'EQUIPMENT',
  'SOFTWARE',
  'FACILITY',
  'SUPPLIER',
  'OTHER',
] as const;
export const changeRiskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateChangeControlDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  title!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  description!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  justification!: string;

  @ApiProperty({ enum: changeControlCategories })
  @IsIn(changeControlCategories)
  category!: (typeof changeControlCategories)[number];

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  targetCompletionAt!: string;
}

export class ChangeControlTaskPlanDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  title!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  description!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  assignedToUserId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;
}

export class AssessChangeControlDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  impactSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  qualityImpact!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  regulatoryImpact!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  validationImpact!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  trainingImpact!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  documentImpact!: string;

  @ApiProperty({ enum: changeRiskLevels })
  @IsIn(changeRiskLevels)
  riskLevel!: (typeof changeRiskLevels)[number];

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  riskRationale!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  implementationPlan!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rollbackPlan!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  ownerUserId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  approverUserId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  verifierUserId!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  verificationCriterion!: string;

  @ApiProperty({ type: ChangeControlTaskPlanDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => ChangeControlTaskPlanDto)
  tasks!: ChangeControlTaskPlanDto[];
}

export class DecideChangeControlDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  comment!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class CompleteChangeTaskDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  comment!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class VerifyChangeControlDto {
  @ApiProperty({ enum: ['EFFECTIVE', 'INEFFECTIVE'] })
  @IsIn(['EFFECTIVE', 'INEFFECTIVE'])
  decision!: 'EFFECTIVE' | 'INEFFECTIVE';

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  evidence!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class CancelChangeControlDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class ChangeControlListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ enum: changeControlStatuses })
  @IsOptional()
  @IsIn(changeControlStatuses)
  status?: (typeof changeControlStatuses)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

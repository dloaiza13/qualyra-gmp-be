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
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const productReviewStatuses = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'FOLLOW_UP_REQUIRED',
  'CANCELLED',
] as const;

export const productReviewDecisions = ['APPROVE', 'REQUIRE_FOLLOW_UP'] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateProductReviewDto {
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
  @Length(2, 120)
  dosageForm!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  strength!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  marketAuthorization!: string;

  @ApiProperty({ format: 'date' })
  @IsISO8601({ strict: true })
  periodStart!: string;

  @ApiProperty({ format: 'date' })
  @IsISO8601({ strict: true })
  periodEnd!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  targetCompletionAt!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  approverUserId!: string;
}

export class PrepareProductReviewDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  batchesManufactured!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  batchesReleased!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  batchesRejected!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  outOfSpecificationCount!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stabilityExceptionCount!: number;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  returnedUnitCount!: number;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  manufacturingSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  startingMaterialsSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  criticalQualityAttributesSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  processPerformanceSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  stabilitySummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  validationSummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  regulatorySummary!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  trendAnalysis!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  benefitRiskConclusion!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  recommendations!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 3000)
  evidenceReference!: string;

  @ApiProperty()
  @IsBoolean()
  continuedManufactureRecommended!: boolean;

  @ApiProperty()
  @IsBoolean()
  capaRequired!: boolean;

  @ApiProperty()
  @IsBoolean()
  changeControlRequired!: boolean;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class DecideProductReviewDto {
  @ApiProperty({ enum: productReviewDecisions })
  @IsIn(productReviewDecisions)
  decision!: (typeof productReviewDecisions)[number];

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  rationale!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 2000)
  followUpReference!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  nextReviewAt!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class CancelProductReviewDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 1000)
  reason!: string;
}

export class ProductReviewTrendQueryDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  productCode!: string;

  @ApiProperty({ format: 'date' })
  @IsISO8601({ strict: true })
  periodStart!: string;

  @ApiProperty({ format: 'date' })
  @IsISO8601({ strict: true })
  periodEnd!: string;
}

export class ProductReviewListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ enum: productReviewStatuses })
  @IsOptional()
  @IsIn(productReviewStatuses)
  status?: (typeof productReviewStatuses)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

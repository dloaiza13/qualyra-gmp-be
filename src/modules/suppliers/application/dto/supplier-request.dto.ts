import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsInt,
  IsISO31661Alpha2,
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

export const supplierCategories = [
  'RAW_MATERIAL',
  'PACKAGING_MATERIAL',
  'SERVICE',
  'CONTRACT_MANUFACTURER',
  'LABORATORY',
  'LOGISTICS',
  'OTHER',
] as const;
export const supplierCriticalities = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export const supplierStatuses = [
  'PENDING_QUALIFICATION',
  'APPROVED',
  'CONDITIONALLY_APPROVED',
  'DISQUALIFIED',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateSupplierDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  legalName!: string;
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(2, 200)
  tradeName?: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  registrationNumber!: string;
  @ApiProperty({ enum: supplierCategories })
  @IsIn(supplierCategories)
  category!: (typeof supplierCategories)[number];
  @ApiProperty({ enum: supplierCriticalities })
  @IsIn(supplierCriticalities)
  criticality!: (typeof supplierCriticalities)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  scopeOfSupply!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  manufacturingSite!: string;
  @ApiProperty({ example: 'CR' })
  @Transform(trimString)
  @IsISO31661Alpha2()
  countryCode!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  contactName!: string;
  @ApiProperty({ format: 'email' })
  @Transform(trimString)
  @IsEmail()
  @MaxLength(320)
  contactEmail!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') qualityOwnerUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') approverUserId!: string;
}

export class CompleteSupplierQualificationDto {
  @ApiProperty({ enum: ['INITIAL', 'PERIODIC', 'EVENT_DRIVEN'] })
  @IsIn(['INITIAL', 'PERIODIC', 'EVENT_DRIVEN'])
  type!: 'INITIAL' | 'PERIODIC' | 'EVENT_DRIVEN';
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  qualitySystemScore!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  complianceScore!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  deliveryScore!: number;
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  serviceScore!: number;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  evidenceSummary!: string;
  @ApiProperty({ enum: ['APPROVE', 'CONDITIONALLY_APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'CONDITIONALLY_APPROVE', 'REJECT'])
  recommendation!: 'APPROVE' | 'CONDITIONALLY_APPROVE' | 'REJECT';
  @ApiPropertyOptional()
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(3, 3000)
  conditions?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  qualityRiskId?: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class DecideSupplierQualificationDto {
  @ApiProperty({ enum: ['APPROVE', 'CONDITIONALLY_APPROVE', 'DISQUALIFY'] })
  @IsIn(['APPROVE', 'CONDITIONALLY_APPROVE', 'DISQUALIFY'])
  decision!: 'APPROVE' | 'CONDITIONALLY_APPROVE' | 'DISQUALIFY';
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rationale!: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextReviewAt?: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class CreateSupplierScarDto {
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
  @Length(2, 1000)
  requirementReference!: string;
  @ApiProperty({ enum: ['MINOR', 'MAJOR', 'CRITICAL'] })
  @IsIn(['MINOR', 'MAJOR', 'CRITICAL'])
  severity!: 'MINOR' | 'MAJOR' | 'CRITICAL';
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;
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
}

export class SubmitSupplierScarResponseDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  response!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  rootCause!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  correction!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 5000)
  correctiveAction!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  evidenceReference!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class ReviewSupplierScarResponseDto {
  @ApiProperty({ enum: ['ACCEPT', 'REQUEST_REVISION'] })
  @IsIn(['ACCEPT', 'REQUEST_REVISION'])
  decision!: 'ACCEPT' | 'REQUEST_REVISION';
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  comment!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class SupplierListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
  @ApiPropertyOptional({ enum: supplierStatuses })
  @IsOptional()
  @IsIn(supplierStatuses)
  status?: (typeof supplierStatuses)[number];
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

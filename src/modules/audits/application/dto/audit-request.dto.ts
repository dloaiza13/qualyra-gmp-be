import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
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

export const auditTypes = [
  'INTERNAL',
  'SUPPLIER',
  'REGULATORY',
  'PROCESS',
] as const;
export const auditStatuses = [
  'PLANNED',
  'IN_PROGRESS',
  'FOLLOW_UP',
  'READY_FOR_CLOSURE',
  'CLOSED',
  'CANCELLED',
] as const;
export const findingClassifications = [
  'OBSERVATION',
  'MINOR',
  'MAJOR',
  'CRITICAL',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateAuditDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  title!: string;
  @ApiProperty({ enum: auditTypes })
  @IsIn(auditTypes)
  type!: (typeof auditTypes)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  scope!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  objectives!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 3000)
  criteria!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  scheduledStartAt!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  scheduledEndAt!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') leadAuditorUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') reviewerUserId!: string;
}

export class AddAuditFindingDto {
  @ApiProperty({ enum: findingClassifications })
  @IsIn(findingClassifications)
  classification!: (typeof findingClassifications)[number];
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
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') responsibleUserId!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  responseDueAt!: string;
}

export class CompleteAuditReportDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  summary!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  conclusion!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class SubmitFindingResponseDto {
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
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  capaId?: string;
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

export class ReviewFindingResponseDto {
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

export class CloseAuditDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  conclusion!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class CancelAuditDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AuditListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
  @ApiPropertyOptional({ enum: auditStatuses })
  @IsOptional()
  @IsIn(auditStatuses)
  status?: (typeof auditStatuses)[number];
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

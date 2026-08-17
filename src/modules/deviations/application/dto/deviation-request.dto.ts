import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
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

export const deviationStatuses = [
  'REPORTED',
  'UNDER_INVESTIGATION',
  'CANCELLED',
] as const;
export const deviationSeverities = ['MINOR', 'MAJOR', 'CRITICAL'] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateDeviationDto {
  @ApiProperty({ example: 'Temperature excursion during material staging' })
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  title!: string;

  @ApiProperty({ example: 'The staging area exceeded its approved limit.' })
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  description!: string;

  @ApiProperty({ example: 'Warehouse' })
  @Transform(trimString)
  @IsString()
  @Length(2, 120)
  area!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  occurredAt!: string;
}

export class TriageDeviationDto {
  @ApiProperty({ enum: deviationSeverities })
  @IsIn(deviationSeverities)
  severity!: (typeof deviationSeverities)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  investigatorUserId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  investigationDueAt!: string;

  @ApiProperty({ example: 'Potential impact is limited to the staged lot.' })
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  impactAssessment!: string;

  @ApiProperty({
    example: 'The affected material was segregated and labelled.',
  })
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  containmentAction!: string;
}

export class CancelDeviationDto {
  @ApiProperty({ example: 'The report was confirmed as a duplicate.' })
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class DeviationListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ enum: deviationStatuses })
  @IsOptional()
  @IsIn(deviationStatuses)
  status?: (typeof deviationStatuses)[number];

  @ApiPropertyOptional({ enum: deviationSeverities })
  @IsOptional()
  @IsIn(deviationSeverities)
  severity?: (typeof deviationSeverities)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

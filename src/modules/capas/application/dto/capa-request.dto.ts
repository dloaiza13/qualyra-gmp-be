import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  Equals,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const capaActionTypes = ['CORRECTIVE', 'PREVENTIVE'] as const;
export const capaEffectivenessDecisions = ['EFFECTIVE', 'INEFFECTIVE'] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateCapaActionDto {
  @ApiProperty({ enum: capaActionTypes })
  @IsIn(capaActionTypes)
  type!: (typeof capaActionTypes)[number];

  @ApiProperty({ example: 'Add relay degradation checks to maintenance' })
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  title!: string;

  @ApiProperty({ example: 'Revise the maintenance checklist and train staff.' })
  @Transform(trimString)
  @IsString()
  @Length(10, 2000)
  description!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  assignedToUserId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;
}

export class CreateCapaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  deviationId!: string;

  @ApiProperty({ example: 'Warehouse cooling reliability improvement' })
  @Transform(trimString)
  @IsString()
  @Length(5, 200)
  title!: string;

  @ApiProperty({
    example: 'Prevent recurrence of staging temperature excursions.',
  })
  @Transform(trimString)
  @IsString()
  @Length(10, 2000)
  objective!: string;

  @ApiProperty({ type: CreateCapaActionDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateCapaActionDto)
  actions!: CreateCapaActionDto[];
}

export class CompleteCapaActionDto {
  @ApiProperty({
    example: 'Checklist revised, approved and deployed to maintenance.',
  })
  @Transform(trimString)
  @IsString()
  @Length(10, 2000)
  comment!: string;

  @ApiProperty({ example: 'current account password', writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class ScheduleCapaEffectivenessReviewDto {
  @ApiProperty({
    example:
      'Confirm no repeat cooling relay alarms occur during three consecutive monitored staging cycles.',
  })
  @Transform(trimString)
  @IsString()
  @Length(10, 2000)
  criterion!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  assignedToUserId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;
}

export class CompleteCapaEffectivenessReviewDto {
  @ApiProperty({ enum: capaEffectivenessDecisions })
  @IsIn(capaEffectivenessDecisions)
  decision!: (typeof capaEffectivenessDecisions)[number];

  @ApiProperty({
    example:
      'Three monitored staging cycles completed without relay alarms or temperature excursions.',
  })
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  evidence!: string;

  @ApiProperty({ example: 'current account password', writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class CapaListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

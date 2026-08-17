import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const trainingAssignmentStatuses = [
  'ASSIGNED',
  'COMPLETED',
  'CANCELLED',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateTrainingAssignmentsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  documentId!: string;

  @ApiProperty({ type: String, format: 'uuid', isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assigneeUserIds!: string[];

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  dueAt!: string;

  @ApiProperty({ example: 'Required reading after controlled release.' })
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class CompleteTrainingAssignmentDto {
  @ApiProperty({
    example: 'I reviewed the effective procedure and its responsibilities.',
  })
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  comment!: string;

  @ApiProperty({ example: 'current account password', writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ example: true })
  @Equals(true)
  attestationAccepted!: true;
}

export class CancelTrainingAssignmentDto {
  @ApiProperty({
    example: 'Assignment replaced after a training impact reassessment.',
  })
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class TrainingAssignmentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ enum: trainingAssignmentStatuses })
  @IsOptional()
  @IsIn(trainingAssignmentStatuses)
  status?: (typeof trainingAssignmentStatuses)[number];
}

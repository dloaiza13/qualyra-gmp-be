import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const documentTypes = [
  'POLICY',
  'SOP',
  'WORK_INSTRUCTION',
  'FORM',
  'SPECIFICATION',
  'OTHER',
] as const;

export const documentStatuses = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'EFFECTIVE',
  'OBSOLETE',
] as const;

export const documentDecisions = ['APPROVE', 'REJECT'] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeCode({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class CreateDocumentDto {
  @ApiProperty({ example: 'QMS-SOP-001' })
  @Transform(normalizeCode)
  @IsString()
  @Length(3, 50)
  code!: string;

  @ApiProperty({ enum: documentTypes, example: 'SOP' })
  @IsIn(documentTypes)
  type!: (typeof documentTypes)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  ownerUserId?: string;

  @ApiProperty({ example: 'Control of GMP documents' })
  @Transform(trimString)
  @IsString()
  @Length(3, 300)
  title!: string;

  @ApiPropertyOptional({
    example: 'Defines the controlled document lifecycle.',
  })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '1. Purpose\nThis procedure defines...' })
  @Transform(trimString)
  @IsString()
  @Length(1, 100000)
  content!: string;

  @ApiProperty({ example: 'Initial controlled draft.' })
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  changeSummary!: string;
}

export class CreateDocumentVersionDto {
  @ApiProperty({ example: 'Control of GMP documents' })
  @Transform(trimString)
  @IsString()
  @Length(3, 300)
  title!: string;

  @ApiPropertyOptional({
    example: 'Defines the controlled document lifecycle.',
  })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '1. Purpose\nThis revised procedure defines...' })
  @Transform(trimString)
  @IsString()
  @Length(1, 100000)
  content!: string;

  @ApiProperty({ example: 'Clarified document ownership.' })
  @Transform(trimString)
  @IsString()
  @Length(3, 500)
  changeSummary!: string;
}

export class RequestDocumentReviewDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  reviewerUserId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  approverUserId!: string;
}

export class DocumentDecisionDto {
  @ApiProperty({ enum: documentDecisions })
  @IsIn(documentDecisions)
  decision!: (typeof documentDecisions)[number];

  @ApiProperty({ example: 'Reviewed against the current GMP procedure.' })
  @Transform(trimString)
  @IsString()
  @Length(3, 2000)
  comment!: string;
}

export class DocumentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;

  @ApiPropertyOptional({ enum: documentTypes })
  @IsOptional()
  @IsIn(documentTypes)
  type?: (typeof documentTypes)[number];

  @ApiPropertyOptional({ enum: documentStatuses })
  @IsOptional()
  @IsIn(documentStatuses)
  status?: (typeof documentStatuses)[number];

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

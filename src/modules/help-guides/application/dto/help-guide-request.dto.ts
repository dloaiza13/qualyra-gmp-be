import { PartialType } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HelpGuideContext } from '../../../../generated/prisma/client.js';

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function optionalUrl({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

export class HelpGuideContextParamDto {
  @ApiProperty({ enum: HelpGuideContext })
  @IsEnum(HelpGuideContext)
  context!: HelpGuideContext;
}

export class HelpGuideListQueryDto {
  @ApiPropertyOptional({ enum: HelpGuideContext })
  @IsOptional()
  @IsEnum(HelpGuideContext)
  context?: HelpGuideContext;

  @ApiPropertyOptional({ default: false })
  @Type(() => Boolean)
  @IsOptional()
  @IsBoolean()
  includeArchived = false;
}

export class CreateHelpGuideDto {
  @ApiProperty({ enum: HelpGuideContext })
  @IsEnum(HelpGuideContext)
  context!: HelpGuideContext;

  @ApiProperty({ example: 'documentos-del-sitio' })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(3, 100)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 160)
  titleEs!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 160)
  titleEn!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 600)
  summaryEs!: string;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 600)
  summaryEn!: string;

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(3, 1000, { each: true })
  stepsEs!: string[];

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(3, 1000, { each: true })
  stepsEn!: string[];

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  @Transform(optionalUrl)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  mediaUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  @Transform(optionalUrl)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  videoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(optionalUrl)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Length(3, 160)
  resourceLabelEs?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(optionalUrl)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsString()
  @Length(3, 160)
  resourceLabelEn?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  @Transform(optionalUrl)
  @IsOptional()
  @ValidateIf((_, value: unknown) => value !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  resourceUrl?: string | null;
}

export class UpdateHelpGuideDto extends PartialType(CreateHelpGuideDto) {}

export class HelpGuideFeedbackDto {
  @ApiProperty()
  @IsBoolean()
  helpful!: boolean;
}

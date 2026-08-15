import { Transform, type TransformFnParams, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'Training Coordinator' })
  @Transform(trimString)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({ example: 'Coordinates employee training.' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Training Lead' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ example: 'Leads employee training.' })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: String, isArray: true, format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}

export class RoleListQueryDto {
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 200 })
  @Type(() => Number)
  @IsOptional()
  limit = 100;
}

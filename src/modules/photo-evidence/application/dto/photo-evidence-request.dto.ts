import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PhotoEvidenceSubjectType } from '../../../../generated/prisma/client.js';

export class PhotoEvidenceSubjectQueryDto {
  @IsEnum(PhotoEvidenceSubjectType)
  subjectType!: PhotoEvidenceSubjectType;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class UploadPhotoEvidenceDto {
  @IsEnum(PhotoEvidenceSubjectType)
  subjectType!: PhotoEvidenceSubjectType;

  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  capturedAt?: string;
}

import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SecurityEventQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ example: 'USER_INVITED' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;
}

export class SecurityEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ enum: ['SUCCESS', 'FAILURE'] })
  outcome!: string;

  @ApiPropertyOptional({ nullable: true })
  actor!: string | null;

  @ApiPropertyOptional({ nullable: true })
  subject!: string | null;

  @ApiProperty({ format: 'uuid' })
  correlationId!: string;

  @ApiPropertyOptional({ nullable: true })
  ipAddress!: string | null;

  @ApiProperty({ type: Object, nullable: true })
  metadata!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

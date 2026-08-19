import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const notificationDeliveryStatuses = [
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'DEAD_LETTER',
] as const;

export type NotificationDeliveryStatus =
  (typeof notificationDeliveryStatuses)[number];

export class NotificationDeliveryQueryDto {
  @ApiPropertyOptional({ enum: notificationDeliveryStatuses })
  @IsOptional()
  @IsIn(notificationDeliveryStatuses)
  status?: NotificationDeliveryStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class NotificationDeliveryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: notificationDeliveryStatuses })
  status!: NotificationDeliveryStatus;

  @ApiProperty()
  attempts!: number;

  @ApiProperty()
  manualRetries!: number;

  @ApiProperty({ format: 'date-time' })
  availableAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastAttemptAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  processedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deadLetteredAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  lastError!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

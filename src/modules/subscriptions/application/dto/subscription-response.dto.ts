import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingInterval,
  SubscriptionStatus,
} from '../../../../generated/prisma/client.js';

export class SubscriptionResponseDto {
  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty({ enum: BillingInterval })
  billingInterval!: BillingInterval;

  @ApiProperty()
  provider!: string;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  currentPeriodStartsAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  currentPeriodEndsAt!: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  graceEndsAt!: string | null;

  @ApiProperty()
  cancelAtPeriodEnd!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  canceledAt!: string | null;

  @ApiProperty()
  writeAccess!: boolean;

  @ApiProperty()
  attentionRequired!: boolean;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

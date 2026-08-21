import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  BillingInterval,
  TenantPlan,
  TenantStatus,
} from '../../../../generated/prisma/client.js';
import { RegisterCompanyDto } from '../../../authentication/application/dto/auth-request.dto.js';

export const platformSubscriptionActions = [
  'RENEW',
  'START_GRACE_PERIOD',
  'SCHEDULE_CANCELLATION',
  'CANCEL_NOW',
  'REACTIVATE',
] as const;
export type PlatformSubscriptionAction =
  (typeof platformSubscriptionActions)[number];

export const normalizedBillingEventTypes = [
  'SUBSCRIPTION_ACTIVATED',
  'SUBSCRIPTION_RENEWED',
  'PAYMENT_FAILED',
  'CANCELLATION_SCHEDULED',
  'SUBSCRIPTION_CANCELED',
  'SUBSCRIPTION_REACTIVATED',
  'TRIAL_EXPIRED',
] as const;
export type NormalizedBillingEventType =
  (typeof normalizedBillingEventTypes)[number];

export class CreatePlatformTenantDto extends OmitType(RegisterCompanyDto, [
  'password',
] as const) {
  @ApiProperty({ enum: TenantPlan })
  @IsEnum(TenantPlan)
  plan!: TenantPlan;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class PlatformTenantQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 25 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 25;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: TenantPlan })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}

export class UpdatePlatformTenantDto {
  @ApiPropertyOptional({ enum: TenantPlan })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  acknowledgeOverQuota = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  acknowledgeUserOverage = false;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

export class PlatformAuditEventQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class UpdatePlatformSubscriptionDto {
  @ApiProperty({ enum: platformSubscriptionActions })
  @IsIn(platformSubscriptionActions)
  action!: PlatformSubscriptionAction;

  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  currentPeriodEndsAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  graceEndsAt?: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}

export class ProcessBillingProviderEventDto {
  @ApiProperty({ minLength: 2, maxLength: 50, example: 'STRIPE' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  provider!: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  providerEventId!: string;

  @ApiProperty({ enum: normalizedBillingEventTypes })
  @IsIn(normalizedBillingEventTypes)
  eventType!: NormalizedBillingEventType;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true })
  occurredAt!: string;

  @ApiPropertyOptional({ enum: TenantPlan })
  @IsOptional()
  @IsEnum(TenantPlan)
  plan?: TenantPlan;

  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  currentPeriodStartsAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  currentPeriodEndsAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  graceEndsAt?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerCustomerId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerSubscriptionId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean | null>;
}

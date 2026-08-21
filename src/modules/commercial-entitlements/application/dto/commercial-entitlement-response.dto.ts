import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  commercialModules,
  type CommercialModule,
  type CommercialModuleAccess,
} from '../commercial-entitlement.policy.js';

export class CommercialModuleEntitlementDto {
  @ApiProperty({ enum: commercialModules })
  code!: CommercialModule;

  @ApiProperty({ enum: ['FULL', 'READ_ONLY'] })
  access!: CommercialModuleAccess;
}

export class CommercialEntitlementsResponseDto {
  @ApiPropertyOptional({ nullable: true, minimum: 1 })
  userLimit!: number | null;

  @ApiProperty()
  committedUsers!: number;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  remainingUserSeats!: number | null;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  trialEndsAt!: string | null;

  @ApiProperty()
  trialExpired!: boolean;

  @ApiPropertyOptional({ nullable: true, minimum: 0 })
  trialDaysRemaining!: number | null;

  @ApiProperty()
  writeAccess!: boolean;

  @ApiProperty({ type: CommercialModuleEntitlementDto, isArray: true })
  modules!: CommercialModuleEntitlementDto[];
}

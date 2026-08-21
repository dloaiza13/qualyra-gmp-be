import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommercialEntitlementsResponseDto } from '../../../commercial-entitlements/application/dto/commercial-entitlement-response.dto.js';

export class AuthenticatedUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: ['INVITED', 'ACTIVE', 'LOCKED', 'DISABLED'] })
  status!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  emailVerifiedAt!: string | null;
}

export class TenantSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class AuthenticationResponseDto {
  @ApiProperty({ description: 'Short-lived RS256 access token.' })
  accessToken!: string;

  @ApiProperty({
    description: 'Double-submit token for cookie-based operations.',
  })
  csrfToken!: string;

  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;

  @ApiProperty({ type: TenantSummaryDto })
  tenant!: TenantSummaryDto;
}

export class MeResponseDto {
  @ApiProperty({ type: AuthenticatedUserDto })
  user!: AuthenticatedUserDto;

  @ApiProperty({ type: TenantSummaryDto })
  tenant!: TenantSummaryDto;

  @ApiProperty({ type: String, isArray: true })
  roles!: string[];

  @ApiProperty({ type: String, isArray: true })
  permissions!: string[];

  @ApiProperty({ type: CommercialEntitlementsResponseDto })
  commercialEntitlements!: CommercialEntitlementsResponseDto;
}

export class NeutralResponseDto {
  @ApiProperty({ example: true })
  accepted!: boolean;
}

export class TenantAvailabilityResponseDto {
  @ApiProperty()
  available!: boolean;
}

export class RegistrationPolicyResponseDto {
  @ApiProperty({
    description: 'Whether a visitor can create a new organization.',
  })
  publicCompanyRegistrationEnabled!: boolean;

  @ApiProperty({
    enum: ['INVITATION_ONLY'],
    description: 'How users join an organization that already exists.',
  })
  existingOrganizationMembership!: 'INVITATION_ONLY';
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  device!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  lastUsedAt!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ enum: ['ACTIVE', 'REVOKED', 'EXPIRED'] })
  status!: string;
}

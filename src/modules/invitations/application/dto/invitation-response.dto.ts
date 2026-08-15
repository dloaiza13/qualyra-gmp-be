import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InvitationRoleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

export class InvitationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] })
  status!: string;

  @ApiProperty({ type: InvitationRoleResponseDto, isArray: true })
  roles!: InvitationRoleResponseDto[];

  @ApiProperty()
  invitedBy!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  acceptedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  lastSentAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class InvitationPreviewDto {
  @ApiProperty()
  tenantName!: string;

  @ApiProperty()
  tenantSlug!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ type: InvitationRoleResponseDto, isArray: true })
  roles!: InvitationRoleResponseDto[];

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

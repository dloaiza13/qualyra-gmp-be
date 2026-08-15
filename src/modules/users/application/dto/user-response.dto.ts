import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserRoleSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  isSystem!: boolean;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: ['ACTIVE', 'LOCKED', 'DISABLED', 'INVITED'] })
  status!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  emailVerifiedAt!: string | null;

  @ApiProperty({ type: UserRoleSummaryDto, isArray: true })
  roles!: UserRoleSummaryDto[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsNotIn,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const reservedSlugs = [
  'admin',
  'api',
  'app',
  'login',
  'register',
  'support',
  'www',
];

function normalizeLowercase({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RegisterCompanyDto {
  @ApiProperty({ example: 'ACME Pharma' })
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  tenantName!: string;

  @ApiProperty({ example: 'acme-pharma' })
  @Transform(normalizeLowercase)
  @IsString()
  @Length(3, 63)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @IsNotIn(reservedSlugs, { message: 'tenantSlug is reserved.' })
  tenantSlug!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  adminName!: string;

  @ApiProperty({ example: 'jane@acme.example' })
  @Transform(normalizeLowercase)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'a long passphrase', minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'acme-pharma' })
  @Transform(normalizeLowercase)
  @IsString()
  @Length(3, 63)
  tenant!: string;

  @ApiProperty({ example: 'jane@acme.example' })
  @Transform(normalizeLowercase)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'a long passphrase' })
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class TenantAvailabilityQueryDto {
  @ApiProperty({ example: 'acme-pharma' })
  @Transform(normalizeLowercase)
  @IsString()
  @Length(3, 63)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @IsNotIn(reservedSlugs, { message: 'slug is reserved.' })
  slug!: string;
}

export class TenantEmailDto {
  @ApiProperty({ example: 'acme-pharma' })
  @Transform(normalizeLowercase)
  @IsString()
  @Length(3, 63)
  tenant!: string;

  @ApiProperty({ example: 'jane@acme.example' })
  @Transform(normalizeLowercase)
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class TokenDto {
  @ApiProperty({ description: 'Opaque one-time token received by email.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @ApiProperty({
    example: 'a new long passphrase',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

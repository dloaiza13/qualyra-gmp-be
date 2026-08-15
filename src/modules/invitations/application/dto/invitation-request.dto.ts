import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

function normalizeEmail({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateInvitationDto {
  @ApiProperty({ example: 'operator@acme.example' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  roleIds!: string[];
}

export class InvitationTokenDto {
  @ApiProperty({ description: 'Opaque invitation token received by email.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;
}

export class AcceptInvitationDto extends InvitationTokenDto {
  @ApiProperty({ example: 'Alex Morgan' })
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  displayName!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128)
  password!: string;
}

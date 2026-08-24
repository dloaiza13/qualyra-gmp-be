import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  UserLocalePreference,
  UserThemePreference,
} from '../../../../generated/prisma/client.js';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsEnum(UserThemePreference)
  themePreference?: UserThemePreference;

  @IsOptional()
  @IsEnum(UserLocalePreference)
  localePreference?: UserLocalePreference;
}

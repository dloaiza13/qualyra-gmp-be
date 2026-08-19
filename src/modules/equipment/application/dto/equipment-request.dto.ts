import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const equipmentCategories = [
  'PRODUCTION',
  'LABORATORY',
  'UTILITY',
  'MEASUREMENT',
  'COMPUTERIZED_SYSTEM',
  'OTHER',
] as const;
export const equipmentCriticalities = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export const equipmentStatuses = [
  'ACTIVE',
  'OUT_OF_SERVICE',
  'RETIRED',
] as const;

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateEquipmentDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(3, 200)
  name!: string;
  @ApiProperty({ enum: equipmentCategories })
  @IsIn(equipmentCategories)
  category!: (typeof equipmentCategories)[number];
  @ApiProperty({ enum: equipmentCriticalities })
  @IsIn(equipmentCriticalities)
  criticality!: (typeof equipmentCriticalities)[number];
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 200)
  manufacturer!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(1, 150)
  model!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  serialNumber!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 300)
  location!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  processArea!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  intendedUse!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') ownerUserId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') verifierUserId!: string;
  @ApiProperty() @IsBoolean() calibrationRequired!: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  calibrationIntervalDays?: number;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextCalibrationAt?: string;
  @ApiProperty() @IsBoolean() maintenanceRequired!: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 3650 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  maintenanceIntervalDays?: number;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextMaintenanceAt?: string;
}

export class CompleteCalibrationDto {
  @ApiProperty({ enum: ['PASS', 'FAIL'] })
  @IsIn(['PASS', 'FAIL'])
  result!: 'PASS' | 'FAIL';
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 1000)
  certificateReference!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 1000)
  standardReference!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  readingsSummary!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class CompleteMaintenanceDto {
  @ApiProperty({ enum: ['PREVENTIVE', 'CORRECTIVE'] })
  @IsIn(['PREVENTIVE', 'CORRECTIVE'])
  type!: 'PREVENTIVE' | 'CORRECTIVE';
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 1000)
  workOrderReference!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 5000)
  workPerformed!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 3000)
  partsAndMaterials!: string;
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(2, 3000)
  evidenceReference!: string;
  @ApiProperty({ enum: ['SATISFACTORY', 'UNSATISFACTORY'] })
  @IsIn(['SATISFACTORY', 'UNSATISFACTORY'])
  result!: 'SATISFACTORY' | 'UNSATISFACTORY';
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class ReviewEquipmentRecordDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] })
  @IsIn(['ACCEPT', 'REJECT'])
  decision!: 'ACCEPT' | 'REJECT';
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 3000)
  rationale!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class RetireEquipmentDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @Length(10, 1000)
  reason!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  password!: string;
  @ApiProperty({ example: true }) @Equals(true) attestationAccepted!: true;
}

export class EquipmentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 100;
  @ApiPropertyOptional({ enum: equipmentStatuses })
  @IsOptional()
  @IsIn(equipmentStatuses)
  status?: (typeof equipmentStatuses)[number];
  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

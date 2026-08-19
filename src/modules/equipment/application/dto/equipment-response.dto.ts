import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EquipmentUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class EquipmentParticipantResponseDto extends EquipmentUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class EquipmentSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'EQP-2026-0001' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() category!: string;
  @ApiProperty() criticality!: string;
  @ApiProperty() manufacturer!: string;
  @ApiProperty() model!: string;
  @ApiProperty() serialNumber!: string;
  @ApiProperty() location!: string;
  @ApiProperty() processArea!: string;
  @ApiProperty() status!: string;
  @ApiProperty() approvedForUse!: boolean;
  @ApiProperty() complianceState!: string;
  @ApiProperty() calibrationRequired!: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  nextCalibrationAt!: string | null;
  @ApiProperty() maintenanceRequired!: boolean;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  nextMaintenanceAt!: string | null;
  @ApiProperty({ type: EquipmentUserSummaryDto })
  owner!: EquipmentUserSummaryDto;
  @ApiProperty({ type: EquipmentUserSummaryDto })
  verifier!: EquipmentUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class EquipmentDetailResponseDto extends EquipmentSummaryResponseDto {
  @ApiProperty() intendedUse!: string;
  @ApiPropertyOptional({ nullable: true }) outOfServiceReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) retirementReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) retiredAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) retirementRecordHash!: string | null;
  @ApiProperty() calibrationIntervalDays!: number | null;
  @ApiProperty() maintenanceIntervalDays!: number | null;
  @ApiProperty({ type: EquipmentUserSummaryDto })
  createdBy!: EquipmentUserSummaryDto;
  @ApiProperty({ type: Object, isArray: true }) calibrations!: Record<
    string,
    unknown
  >[];
  @ApiProperty({ type: Object, isArray: true }) maintenances!: Record<
    string,
    unknown
  >[];
}

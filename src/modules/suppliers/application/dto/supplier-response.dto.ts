import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SupplierUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class SupplierParticipantResponseDto extends SupplierUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class SupplierSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'SUP-2026-0001' }) code!: string;
  @ApiProperty() legalName!: string;
  @ApiPropertyOptional({ nullable: true }) tradeName!: string | null;
  @ApiProperty() category!: string;
  @ApiProperty() criticality!: string;
  @ApiProperty() status!: string;
  @ApiProperty() approvedList!: boolean;
  @ApiProperty() reviewState!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) nextReviewAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) latestScore!: number | null;
  @ApiProperty() openScarCount!: number;
  @ApiProperty({ type: SupplierUserSummaryDto })
  qualityOwner!: SupplierUserSummaryDto;
  @ApiProperty({ type: SupplierUserSummaryDto })
  approver!: SupplierUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SupplierDetailResponseDto extends SupplierSummaryResponseDto {
  @ApiProperty() registrationNumber!: string;
  @ApiProperty() scopeOfSupply!: string;
  @ApiProperty() manufacturingSite!: string;
  @ApiProperty() countryCode!: string;
  @ApiProperty() contactName!: string;
  @ApiProperty() contactEmail!: string;
  @ApiProperty({ type: SupplierUserSummaryDto })
  createdBy!: SupplierUserSummaryDto;
  @ApiProperty({ type: Object, isArray: true }) qualifications!: Record<
    string,
    unknown
  >[];
  @ApiProperty({ type: Object, isArray: true }) scars!: Record<
    string,
    unknown
  >[];
}

export class SupplierReferencesResponseDto {
  @ApiProperty({ type: Object, isArray: true }) qualityRisks!: Record<
    string,
    string
  >[];
  @ApiProperty({ type: Object, isArray: true }) capas!: Record<
    string,
    string
  >[];
  @ApiProperty({ type: Object, isArray: true }) changeControls!: Record<
    string,
    string
  >[];
  @ApiProperty({ type: Object, isArray: true }) audits!: Record<
    string,
    string
  >[];
}

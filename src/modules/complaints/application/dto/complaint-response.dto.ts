import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ComplaintUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class ComplaintParticipantResponseDto extends ComplaintUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class ComplaintReferenceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
}

export class ComplaintReferencesResponseDto {
  @ApiProperty({ type: ComplaintReferenceDto, isArray: true })
  deviations!: ComplaintReferenceDto[];
  @ApiProperty({ type: ComplaintReferenceDto, isArray: true })
  capas!: ComplaintReferenceDto[];
  @ApiProperty({ type: ComplaintReferenceDto, isArray: true })
  suppliers!: ComplaintReferenceDto[];
  @ApiProperty({ type: ComplaintReferenceDto, isArray: true })
  qualityRisks!: ComplaintReferenceDto[];
  @ApiProperty({ type: ComplaintReferenceDto, isArray: true })
  changeControls!: ComplaintReferenceDto[];
}

export class ComplaintSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'PQC-2026-0001' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() source!: string;
  @ApiProperty() category!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty() lotNumber!: string;
  @ApiProperty() status!: string;
  @ApiPropertyOptional({ nullable: true }) severity!: string | null;
  @ApiProperty() potentialSafetyEvent!: boolean;
  @ApiPropertyOptional({ nullable: true }) recallAssessmentRequired!:
    boolean | null;
  @ApiProperty() dueState!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) targetCloseAt!:
    string | null;
  @ApiPropertyOptional({ type: ComplaintUserSummaryDto, nullable: true })
  investigator!: ComplaintUserSummaryDto | null;
  @ApiPropertyOptional({ type: ComplaintUserSummaryDto, nullable: true })
  reviewer!: ComplaintUserSummaryDto | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ComplaintDetailResponseDto extends ComplaintSummaryResponseDto {
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ format: 'date', nullable: true }) expiryDate!:
    string | null;
  @ApiProperty() countryCode!: string;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiPropertyOptional({ nullable: true }) reporterName!: string | null;
  @ApiPropertyOptional({ nullable: true }) reporterContact!: string | null;
  @ApiProperty() evidenceReference!: string;
  @ApiPropertyOptional({ nullable: true }) regulatoryAssessment!: string | null;
  @ApiPropertyOptional({ nullable: true }) immediateActions!: string | null;
  @ApiProperty({ type: ComplaintUserSummaryDto })
  reportedBy!: ComplaintUserSummaryDto;
  @ApiPropertyOptional({ type: ComplaintUserSummaryDto, nullable: true })
  triagedBy!: ComplaintUserSummaryDto | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) triagedAt!:
    string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) investigation!: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) decision!: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) cancelledAt!:
    string | null;
}

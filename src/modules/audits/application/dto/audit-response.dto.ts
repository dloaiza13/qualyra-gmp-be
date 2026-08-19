import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class AuditParticipantResponseDto extends AuditUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class AuditFindingResponseRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() attemptNumber!: number;
  @ApiProperty() response!: string;
  @ApiProperty() rootCause!: string;
  @ApiProperty() correction!: string;
  @ApiProperty() correctiveAction!: string;
  @ApiProperty() evidenceReference!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) capaId!:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) changeControlId!:
    string | null;
  @ApiProperty({ type: AuditUserSummaryDto }) respondedBy!: AuditUserSummaryDto;
  @ApiProperty() responseMeaning!: string;
  @ApiProperty() authenticationMethod!: string;
  @ApiProperty({ format: 'date-time' }) respondedAt!: string;
  @ApiProperty() responseRecordHash!: string;
  @ApiPropertyOptional({ nullable: true }) decision!: string | null;
  @ApiPropertyOptional({ nullable: true }) reviewComment!: string | null;
  @ApiPropertyOptional({ type: AuditUserSummaryDto, nullable: true })
  reviewedBy!: AuditUserSummaryDto | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) reviewedAt!:
    string | null;
  @ApiPropertyOptional({ nullable: true }) reviewRecordHash!: string | null;
}

export class AuditFindingResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() sequenceNumber!: number;
  @ApiProperty() classification!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() requirementReference!: string;
  @ApiProperty({ type: AuditUserSummaryDto }) responsible!: AuditUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) responseDueAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty() dueState!: string;
  @ApiProperty({ type: AuditFindingResponseRecordDto, isArray: true })
  responses!: AuditFindingResponseRecordDto[];
}

export class AuditSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'AUD-2026-0001' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() type!: string;
  @ApiProperty() status!: string;
  @ApiProperty() dueState!: string;
  @ApiProperty({ type: AuditUserSummaryDto }) leadAuditor!: AuditUserSummaryDto;
  @ApiProperty({ type: AuditUserSummaryDto }) reviewer!: AuditUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) scheduledStartAt!: string;
  @ApiProperty({ format: 'date-time' }) scheduledEndAt!: string;
  @ApiProperty() openFindingCount!: number;
  @ApiProperty() findingCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AuditDetailResponseDto extends AuditSummaryResponseDto {
  @ApiProperty() scope!: string;
  @ApiProperty() objectives!: string;
  @ApiProperty() criteria!: string;
  @ApiProperty({ type: AuditUserSummaryDto }) createdBy!: AuditUserSummaryDto;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) startedAt!:
    string | null;
  @ApiProperty({ type: AuditFindingResponseDto, isArray: true })
  findings!: AuditFindingResponseDto[];
  @ApiPropertyOptional({ nullable: true }) report!: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ nullable: true }) closure!: Record<
    string,
    unknown
  > | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true }) cancelledAt!:
    string | null;
}

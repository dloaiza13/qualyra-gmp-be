import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductReviewUserSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'email' }) email!: string;
}

export class ProductReviewParticipantResponseDto extends ProductReviewUserSummaryDto {
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
}

export class ProductReviewMetricDto {
  @ApiProperty() current!: number;
  @ApiProperty() previous!: number;
  @ApiProperty({ nullable: true }) deltaPercent!: number | null;
  @ApiProperty({ enum: ['INCREASE', 'STABLE', 'DECREASE'] }) direction!: string;
}

export class ProductReviewMonthlyTrendDto {
  @ApiProperty() month!: string;
  @ApiProperty() complaints!: number;
  @ApiProperty() recalls!: number;
}

export class ProductReviewTrendSnapshotDto {
  @ApiProperty() productCode!: string;
  @ApiProperty() periodStart!: string;
  @ApiProperty() periodEnd!: string;
  @ApiProperty() previousPeriodStart!: string;
  @ApiProperty() previousPeriodEnd!: string;
  @ApiProperty({ type: ProductReviewMetricDto })
  complaints!: ProductReviewMetricDto;
  @ApiProperty({ type: ProductReviewMetricDto })
  recalls!: ProductReviewMetricDto;
  @ApiProperty() substantiatedComplaints!: number;
  @ApiProperty() criticalComplaints!: number;
  @ApiProperty() reportableComplaints!: number;
  @ApiProperty() closedRecalls!: number;
  @ApiProperty() linkedDeviations!: number;
  @ApiProperty() linkedCapas!: number;
  @ApiProperty() linkedSuppliers!: number;
  @ApiProperty() linkedQualityRisks!: number;
  @ApiProperty() linkedChangeControls!: number;
  @ApiProperty({ type: ProductReviewMonthlyTrendDto, isArray: true })
  monthly!: ProductReviewMonthlyTrendDto[];
  @ApiProperty({ format: 'date-time' }) capturedAt!: string;
}

export class ProductReviewSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'PQR-2026-0001' }) code!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productCode!: string;
  @ApiProperty() dosageForm!: string;
  @ApiProperty() strength!: string;
  @ApiProperty() status!: string;
  @ApiProperty() dueState!: string;
  @ApiProperty({ format: 'date' }) periodStart!: string;
  @ApiProperty({ format: 'date' }) periodEnd!: string;
  @ApiProperty({ format: 'date-time' }) targetCompletionAt!: string;
  @ApiProperty({ type: ProductReviewUserSummaryDto })
  approver!: ProductReviewUserSummaryDto;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ProductReviewDetailResponseDto extends ProductReviewSummaryResponseDto {
  @ApiProperty() marketAuthorization!: string;
  @ApiProperty({ type: ProductReviewUserSummaryDto })
  createdBy!: ProductReviewUserSummaryDto;
  @ApiPropertyOptional({ type: Object, nullable: true })
  assessment!: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  decision!: Record<string, unknown> | null;
  @ApiPropertyOptional({ nullable: true }) cancellationReason!: string | null;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;
}

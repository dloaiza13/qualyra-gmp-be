import { ApiProperty } from '@nestjs/swagger';

export const reportModuleIds = [
  'documents',
  'training',
  'deviations',
  'capas',
  'changes',
  'audits',
  'risks',
  'suppliers',
  'equipment',
  'complaints',
  'recalls',
  'productReviews',
] as const;

export type ReportModuleId = (typeof reportModuleIds)[number];

export class ReportPeriodDto {
  @ApiProperty({ format: 'date' })
  from!: string;

  @ApiProperty({ format: 'date' })
  to!: string;
}

export class ReportStatusBucketDto {
  @ApiProperty()
  status!: string;

  @ApiProperty()
  count!: number;
}

export class ReportModuleSummaryDto {
  @ApiProperty({ enum: reportModuleIds })
  id!: ReportModuleId;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  open!: number;

  @ApiProperty()
  overdue!: number;

  @ApiProperty()
  critical!: number;

  @ApiProperty({ type: ReportStatusBucketDto, isArray: true })
  byStatus!: ReportStatusBucketDto[];
}

export class ReportTrendModuleDto {
  @ApiProperty({ enum: reportModuleIds })
  id!: ReportModuleId;

  @ApiProperty()
  count!: number;
}

export class ReportTrendPointDto {
  @ApiProperty({ example: '2026-08' })
  month!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: ReportTrendModuleDto, isArray: true })
  modules!: ReportTrendModuleDto[];
}

export class OperationalReportKpisDto {
  @ApiProperty()
  totalRecords!: number;

  @ApiProperty()
  openRecords!: number;

  @ApiProperty()
  overdueRecords!: number;

  @ApiProperty()
  criticalRecords!: number;

  @ApiProperty({ nullable: true })
  trainingCompliancePercent!: number | null;

  @ApiProperty({ nullable: true })
  capaEffectivenessPercent!: number | null;
}

export class OperationalReportResponseDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: OperationalReportKpisDto })
  kpis!: OperationalReportKpisDto;

  @ApiProperty({ type: ReportModuleSummaryDto, isArray: true })
  modules!: ReportModuleSummaryDto[];

  @ApiProperty({ type: ReportTrendPointDto, isArray: true })
  trend!: ReportTrendPointDto[];
}

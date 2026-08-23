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

export class ReportMetricComparisonDto {
  @ApiProperty({ nullable: true })
  previous!: number | null;

  @ApiProperty({ nullable: true })
  change!: number | null;

  @ApiProperty({ enum: ['PERCENT', 'POINTS'] })
  changeType!: 'PERCENT' | 'POINTS';
}

export class ReportComparisonDto {
  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: ReportMetricComparisonDto })
  totalRecords!: ReportMetricComparisonDto;

  @ApiProperty({ type: ReportMetricComparisonDto })
  openRecords!: ReportMetricComparisonDto;

  @ApiProperty({ type: ReportMetricComparisonDto })
  overdueRecords!: ReportMetricComparisonDto;

  @ApiProperty({ type: ReportMetricComparisonDto })
  criticalRecords!: ReportMetricComparisonDto;

  @ApiProperty({ type: ReportMetricComparisonDto })
  trainingCompliancePercent!: ReportMetricComparisonDto;

  @ApiProperty({ type: ReportMetricComparisonDto })
  capaEffectivenessPercent!: ReportMetricComparisonDto;
}

export const reportPriorityLevels = ['CRITICAL', 'OVERDUE'] as const;
export type ReportPriorityLevel = (typeof reportPriorityLevels)[number];

export class ReportPriorityItemDto {
  @ApiProperty({ enum: reportModuleIds })
  module!: ReportModuleId;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  dueAt!: string | null;

  @ApiProperty({ nullable: true })
  daysOverdue!: number | null;

  @ApiProperty({ enum: reportPriorityLevels })
  level!: ReportPriorityLevel;
}

export class OperationalReportResponseDto {
  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({ type: ReportPeriodDto })
  period!: ReportPeriodDto;

  @ApiProperty({ type: OperationalReportKpisDto })
  kpis!: OperationalReportKpisDto;

  @ApiProperty({ type: ReportComparisonDto })
  comparison!: ReportComparisonDto;

  @ApiProperty({ type: ReportModuleSummaryDto, isArray: true })
  modules!: ReportModuleSummaryDto[];

  @ApiProperty({ type: ReportTrendPointDto, isArray: true })
  trend!: ReportTrendPointDto[];

  @ApiProperty({ type: ReportPriorityItemDto, isArray: true })
  priorities!: ReportPriorityItemDto[];
}

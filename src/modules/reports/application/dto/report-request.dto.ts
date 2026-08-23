import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export class OperationalReportQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01', format: 'date' })
  @IsOptional()
  @Matches(isoDatePattern)
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', format: 'date' })
  @IsOptional()
  @Matches(isoDatePattern)
  to?: string;
}

export class OperationalReportExportDto extends OperationalReportQueryDto {
  @ApiPropertyOptional({ enum: ['es', 'en'], default: 'es' })
  @IsOptional()
  @IsIn(['es', 'en'])
  locale?: 'es' | 'en';
}

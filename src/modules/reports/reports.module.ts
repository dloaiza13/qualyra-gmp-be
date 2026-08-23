import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ReportsService } from './application/reports.service.js';
import { OperationalReportPdfService } from './application/operational-report-pdf.service.js';
import { ReportsController } from './presentation/reports.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [ReportsController],
  providers: [ReportsService, OperationalReportPdfService],
})
export class ReportsModule {}

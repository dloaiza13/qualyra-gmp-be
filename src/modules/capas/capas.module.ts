import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CapasService } from './application/capas.service.js';
import { CapaEvidenceService } from './application/capa-evidence.service.js';
import { CapaAuditExportService } from './application/capa-audit-export.service.js';
import { CapaMonitoringService } from './application/capa-monitoring.service.js';
import { CapaEvidenceRetentionService } from './application/capa-evidence-retention.service.js';
import { CapaEvidenceInfrastructureModule } from './capa-evidence-infrastructure.module.js';
import { CapasController } from './presentation/capas.controller.js';

@Module({
  imports: [
    PrismaModule,
    AuthorizationModule,
    CapaEvidenceInfrastructureModule,
  ],
  controllers: [CapasController],
  providers: [
    CapasService,
    CapaEvidenceService,
    CapaAuditExportService,
    CapaMonitoringService,
    CapaEvidenceRetentionService,
  ],
})
export class CapasModule {}

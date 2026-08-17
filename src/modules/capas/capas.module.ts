import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CapasService } from './application/capas.service.js';
import { CapaEvidenceService } from './application/capa-evidence.service.js';
import { CapaMonitoringService } from './application/capa-monitoring.service.js';
import { LocalCapaEvidenceStorage } from './infrastructure/local-capa-evidence-storage.js';
import { CapasController } from './presentation/capas.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [CapasController],
  providers: [
    CapasService,
    CapaEvidenceService,
    CapaMonitoringService,
    LocalCapaEvidenceStorage,
  ],
})
export class CapasModule {}

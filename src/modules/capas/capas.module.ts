import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../common/config/environment.js';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CapasService } from './application/capas.service.js';
import { CapaEvidenceService } from './application/capa-evidence.service.js';
import { CapaAuditExportService } from './application/capa-audit-export.service.js';
import { CapaMonitoringService } from './application/capa-monitoring.service.js';
import { CapaEvidenceRetentionService } from './application/capa-evidence-retention.service.js';
import { CapaEvidenceScanner } from './domain/ports/capa-evidence-scanner.js';
import { CapaEvidenceStorage } from './domain/ports/capa-evidence-storage.js';
import { BuiltInCapaEvidenceScanner } from './infrastructure/built-in-capa-evidence-scanner.js';
import { ClamAvCapaEvidenceScanner } from './infrastructure/clamav-capa-evidence-scanner.js';
import { LocalCapaEvidenceStorage } from './infrastructure/local-capa-evidence-storage.js';
import { S3CapaEvidenceStorage } from './infrastructure/s3-capa-evidence-storage.js';
import { CapasController } from './presentation/capas.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [CapasController],
  providers: [
    CapasService,
    CapaEvidenceService,
    CapaAuditExportService,
    CapaMonitoringService,
    CapaEvidenceRetentionService,
    BuiltInCapaEvidenceScanner,
    ClamAvCapaEvidenceScanner,
    LocalCapaEvidenceStorage,
    S3CapaEvidenceStorage,
    {
      provide: CapaEvidenceStorage,
      inject: [ConfigService, LocalCapaEvidenceStorage, S3CapaEvidenceStorage],
      useFactory: (
        config: ConfigService<Environment, true>,
        local: LocalCapaEvidenceStorage,
        s3: S3CapaEvidenceStorage,
      ) =>
        config.getOrThrow('CAPA_EVIDENCE_STORAGE_DRIVER', { infer: true }) ===
        's3'
          ? s3
          : local,
    },
    {
      provide: CapaEvidenceScanner,
      inject: [
        ConfigService,
        BuiltInCapaEvidenceScanner,
        ClamAvCapaEvidenceScanner,
      ],
      useFactory: (
        config: ConfigService<Environment, true>,
        builtIn: BuiltInCapaEvidenceScanner,
        clamav: ClamAvCapaEvidenceScanner,
      ) =>
        config.getOrThrow('CAPA_EVIDENCE_SCANNER', { infer: true }) === 'clamav'
          ? clamav
          : builtIn,
    },
  ],
})
export class CapasModule {}

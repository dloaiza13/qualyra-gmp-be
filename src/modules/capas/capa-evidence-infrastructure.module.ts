import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../common/config/environment.js';
import { CapaEvidenceScanner } from './domain/ports/capa-evidence-scanner.js';
import { CapaEvidenceStorage } from './domain/ports/capa-evidence-storage.js';
import { BuiltInCapaEvidenceScanner } from './infrastructure/built-in-capa-evidence-scanner.js';
import { ClamAvCapaEvidenceScanner } from './infrastructure/clamav-capa-evidence-scanner.js';
import { LocalCapaEvidenceStorage } from './infrastructure/local-capa-evidence-storage.js';
import { S3CapaEvidenceStorage } from './infrastructure/s3-capa-evidence-storage.js';

@Module({
  providers: [
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
  exports: [CapaEvidenceStorage, CapaEvidenceScanner],
})
export class CapaEvidenceInfrastructureModule {}

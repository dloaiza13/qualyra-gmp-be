import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ComplianceService } from './application/compliance.service.js';
import { ComplianceEvidenceSourceResolver } from './domain/compliance-evidence-source.js';
import { PrismaComplianceEvidenceSourceResolver } from './infrastructure/prisma-compliance-evidence-source-resolver.js';
import { ComplianceController } from './presentation/compliance.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [ComplianceController],
  providers: [
    ComplianceService,
    {
      provide: ComplianceEvidenceSourceResolver,
      useClass: PrismaComplianceEvidenceSourceResolver,
    },
  ],
})
export class ComplianceModule {}

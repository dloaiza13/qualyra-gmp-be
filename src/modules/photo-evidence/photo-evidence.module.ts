import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CapaEvidenceInfrastructureModule } from '../capas/capa-evidence-infrastructure.module.js';
import { PhotoEvidenceCapacityPolicy } from './application/photo-evidence-capacity.policy.js';
import { PhotoEvidenceCapacityReconciliationService } from './application/photo-evidence-capacity-reconciliation.service.js';
import { PhotoEvidenceService } from './application/photo-evidence.service.js';
import { PhotoEvidenceController } from './presentation/photo-evidence.controller.js';

@Module({
  imports: [
    AuthenticationModule,
    AuthorizationModule,
    PrismaModule,
    CapaEvidenceInfrastructureModule,
  ],
  controllers: [PhotoEvidenceController],
  providers: [
    PhotoEvidenceCapacityPolicy,
    PhotoEvidenceCapacityReconciliationService,
    PhotoEvidenceService,
  ],
})
export class PhotoEvidenceModule {}

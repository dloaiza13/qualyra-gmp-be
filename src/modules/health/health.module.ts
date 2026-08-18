import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { CapaEvidenceInfrastructureModule } from '../capas/capa-evidence-infrastructure.module.js';
import { HealthService } from './application/health.service.js';
import { HealthController } from './presentation/health.controller.js';

@Module({
  imports: [PrismaModule, CapaEvidenceInfrastructureModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

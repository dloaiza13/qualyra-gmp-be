import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { QualityRisksService } from './application/quality-risks.service.js';
import { QualityRisksController } from './presentation/quality-risks.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [QualityRisksController],
  providers: [QualityRisksService],
})
export class QualityRisksModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuditsService } from './application/audits.service.js';
import { AuditsController } from './presentation/audits.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [AuditsController],
  providers: [AuditsService],
})
export class AuditsModule {}

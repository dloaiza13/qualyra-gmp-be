import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DeviationsService } from './application/deviations.service.js';
import { DeviationsController } from './presentation/deviations.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [DeviationsController],
  providers: [DeviationsService],
})
export class DeviationsModule {}

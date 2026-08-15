import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SecurityEventsService } from './application/security-events.service.js';
import { SecurityEventsController } from './presentation/security-events.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [SecurityEventsController],
  providers: [SecurityEventsService],
})
export class SecurityEventsModule {}

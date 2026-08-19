import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { NotificationDeliveriesController } from './presentation/notification-deliveries.controller.js';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [NotificationDeliveriesController],
})
export class NotificationDeliveriesModule {}

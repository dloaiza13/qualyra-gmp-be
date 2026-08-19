import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { NotificationOutboxService } from './application/notification-outbox.service.js';
import { OutboxPayloadCipher } from './application/outbox-payload-cipher.js';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [NotificationOutboxService, OutboxPayloadCipher],
  exports: [NotificationOutboxService],
})
export class NotificationOutboxModule {}

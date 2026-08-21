import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { UsersService } from './application/users.service.js';
import { UsersController } from './presentation/users.controller.js';
import { CommercialEntitlementsModule } from '../commercial-entitlements/commercial-entitlements.module.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, CommercialEntitlementsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}

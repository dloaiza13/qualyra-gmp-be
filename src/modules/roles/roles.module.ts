import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { RolesService } from './application/roles.service.js';
import { RolesController } from './presentation/roles.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}

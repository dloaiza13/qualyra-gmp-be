import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ChangeControlsService } from './application/change-controls.service.js';
import { ChangeControlsController } from './presentation/change-controls.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [ChangeControlsController],
  providers: [ChangeControlsService],
})
export class ChangeControlsModule {}

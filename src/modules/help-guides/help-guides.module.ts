import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { HelpGuidesService } from './application/help-guides.service.js';
import { HelpGuidesController } from './presentation/help-guides.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [HelpGuidesController],
  providers: [HelpGuidesService],
})
export class HelpGuidesModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { RecallsService } from './application/recalls.service.js';
import { RecallsController } from './presentation/recalls.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [RecallsController],
  providers: [RecallsService],
})
export class RecallsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ComplaintsService } from './application/complaints.service.js';
import { ComplaintsController } from './presentation/complaints.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}

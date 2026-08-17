import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { TrainingService } from './application/training.service.js';
import { TrainingController } from './presentation/training.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [TrainingController],
  providers: [TrainingService],
})
export class TrainingModule {}

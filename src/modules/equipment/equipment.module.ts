import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { EquipmentService } from './application/equipment.service.js';
import { EquipmentController } from './presentation/equipment.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [EquipmentController],
  providers: [EquipmentService],
})
export class EquipmentModule {}

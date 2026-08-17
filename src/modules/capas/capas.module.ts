import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { CapasService } from './application/capas.service.js';
import { CapasController } from './presentation/capas.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [CapasController],
  providers: [CapasService],
})
export class CapasModule {}

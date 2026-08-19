import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { SuppliersService } from './application/suppliers.service.js';
import { SuppliersController } from './presentation/suppliers.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}

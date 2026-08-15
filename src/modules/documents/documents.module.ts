import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DocumentsService } from './application/documents.service.js';
import { DocumentsController } from './presentation/documents.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}

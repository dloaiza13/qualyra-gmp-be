import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { PhotoEvidenceModule } from '../photo-evidence/photo-evidence.module.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { PlatformTenantsService } from './application/platform-tenants.service.js';
import { PlatformAdminGuard } from './presentation/platform-admin.guard.js';
import { PlatformTenantsController } from './presentation/platform-tenants.controller.js';

@Module({
  imports: [PrismaModule, PhotoEvidenceModule, AuthenticationModule],
  controllers: [PlatformTenantsController],
  providers: [PlatformAdminGuard, PlatformTenantsService],
})
export class PlatformAdministrationModule {}

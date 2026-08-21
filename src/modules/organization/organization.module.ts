import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { PhotoEvidenceModule } from '../photo-evidence/photo-evidence.module.js';
import { OrganizationService } from './application/organization.service.js';
import { OrganizationController } from './presentation/organization.controller.js';
import { CommercialEntitlementsModule } from '../commercial-entitlements/commercial-entitlements.module.js';

@Module({
  imports: [
    AuthenticationModule,
    PrismaModule,
    PhotoEvidenceModule,
    CommercialEntitlementsModule,
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService],
})
export class OrganizationModule {}

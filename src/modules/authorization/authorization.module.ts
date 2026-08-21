import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { CommercialEntitlementsModule } from '../commercial-entitlements/commercial-entitlements.module.js';
import { PermissionsGuard } from './presentation/permissions.guard.js';

@Module({
  imports: [PrismaModule, AuthenticationModule, CommercialEntitlementsModule],
  providers: [PermissionsGuard],
  exports: [
    AuthenticationModule,
    CommercialEntitlementsModule,
    PermissionsGuard,
  ],
})
export class AuthorizationModule {}

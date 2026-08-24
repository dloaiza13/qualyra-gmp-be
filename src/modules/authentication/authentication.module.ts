import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationService } from './application/authentication.service.js';
import { AuthenticationController } from './presentation/authentication.controller.js';
import { AuthenticationCookieService } from './presentation/authentication-cookie.service.js';
import { CsrfGuard } from './presentation/csrf.guard.js';
import { JwtAuthGuard } from './presentation/jwt-auth.guard.js';
import { NotificationOutboxModule } from '../notifications/notification-outbox.module.js';
import { CommercialEntitlementsModule } from '../commercial-entitlements/commercial-entitlements.module.js';
import { CapaEvidenceInfrastructureModule } from '../capas/capa-evidence-infrastructure.module.js';
import { ProfileService } from './application/profile.service.js';

@Module({
  imports: [
    PrismaModule,
    NotificationOutboxModule,
    CommercialEntitlementsModule,
    CapaEvidenceInfrastructureModule,
  ],
  controllers: [AuthenticationController],
  providers: [
    AuthenticationService,
    AuthenticationCookieService,
    CsrfGuard,
    JwtAuthGuard,
    ProfileService,
  ],
  exports: [AuthenticationService, AuthenticationCookieService, JwtAuthGuard],
})
export class AuthenticationModule {}

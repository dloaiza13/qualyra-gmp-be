import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationService } from './application/authentication.service.js';
import { AuthenticationController } from './presentation/authentication.controller.js';
import { AuthenticationCookieService } from './presentation/authentication-cookie.service.js';
import { CsrfGuard } from './presentation/csrf.guard.js';
import { JwtAuthGuard } from './presentation/jwt-auth.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthenticationController],
  providers: [
    AuthenticationService,
    AuthenticationCookieService,
    CsrfGuard,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard],
})
export class AuthenticationModule {}

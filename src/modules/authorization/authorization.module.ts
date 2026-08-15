import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { PermissionsGuard } from './presentation/permissions.guard.js';

@Module({
  imports: [PrismaModule, AuthenticationModule],
  providers: [PermissionsGuard],
  exports: [AuthenticationModule, PermissionsGuard],
})
export class AuthorizationModule {}

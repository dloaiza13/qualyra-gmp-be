import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InvitationsService } from './application/invitations.service.js';
import {
  PublicInvitationsController,
  UserInvitationsController,
} from './presentation/invitations.controller.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [UserInvitationsController, PublicInvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}

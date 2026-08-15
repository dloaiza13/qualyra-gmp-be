import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  SecurityEventQueryDto,
  SecurityEventResponseDto,
} from '../application/dto/security-event.dto.js';
import { SecurityEventsService } from '../application/security-events.service.js';

@ApiTags('Security events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('security-events')
export class SecurityEventsController {
  constructor(private readonly events: SecurityEventsService) {}

  @Get()
  @Permissions('security.events.read')
  @ApiOkResponse({ type: SecurityEventResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: SecurityEventQueryDto,
  ): Promise<SecurityEventResponseDto[]> {
    return this.events.list(principal, query);
  }
}

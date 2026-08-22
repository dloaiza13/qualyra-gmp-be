import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import { OrganizationCommercialSummaryDto } from '../application/dto/organization-response.dto.js';
import { OrganizationService } from '../application/organization.service.js';

@ApiTags('Organization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('commercial-summary')
  @Permissions('tenants.read')
  @ApiOkResponse({ type: OrganizationCommercialSummaryDto })
  summary(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<OrganizationCommercialSummaryDto> {
    return this.organization.summary(principal);
  }
}

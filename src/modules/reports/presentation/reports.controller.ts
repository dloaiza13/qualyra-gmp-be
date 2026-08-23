import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import { OperationalReportQueryDto } from '../application/dto/report-request.dto.js';
import { OperationalReportResponseDto } from '../application/dto/report-response.dto.js';
import { ReportsService } from '../application/reports.service.js';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('operational')
  @Permissions('reports.read')
  @ApiOkResponse({ type: OperationalReportResponseDto })
  operational(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: OperationalReportQueryDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<OperationalReportResponseDto> {
    return this.reports.operational(
      principal,
      new Set(request.permissions ?? []),
      query,
    );
  }
}

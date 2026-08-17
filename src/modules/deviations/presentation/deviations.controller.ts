import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  CancelDeviationDto,
  CompleteDeviationInvestigationDto,
  CreateDeviationDto,
  DeviationListQueryDto,
  TriageDeviationDto,
} from '../application/dto/deviation-request.dto.js';
import {
  DeviationDetailResponseDto,
  DeviationSummaryResponseDto,
} from '../application/dto/deviation-response.dto.js';
import { DeviationsService } from '../application/deviations.service.js';

@ApiTags('Deviations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('deviations')
export class DeviationsController {
  constructor(private readonly deviations: DeviationsService) {}

  @Get()
  @Permissions('deviations.read')
  @ApiOkResponse({ type: DeviationSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: DeviationListQueryDto,
  ): Promise<DeviationSummaryResponseDto[]> {
    return this.deviations.list(principal, query);
  }

  @Get(':deviationId')
  @Permissions('deviations.read')
  @ApiOkResponse({ type: DeviationDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('deviationId', new ParseUUIDPipe()) deviationId: string,
  ): Promise<DeviationDetailResponseDto> {
    return this.deviations.get(principal, deviationId);
  }

  @Post()
  @Permissions('deviations.create')
  @ApiCreatedResponse({ type: DeviationDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateDeviationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DeviationDetailResponseDto> {
    return this.deviations.create(principal, input, requestMetadata(request));
  }

  @Post(':deviationId/triage')
  @Permissions('deviations.triage')
  @ApiCreatedResponse({ type: DeviationDetailResponseDto })
  triage(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('deviationId', new ParseUUIDPipe()) deviationId: string,
    @Body() input: TriageDeviationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DeviationDetailResponseDto> {
    return this.deviations.triage(
      principal,
      deviationId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':deviationId/cancel')
  @Permissions('deviations.triage')
  @ApiCreatedResponse({ type: DeviationDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('deviationId', new ParseUUIDPipe()) deviationId: string,
    @Body() input: CancelDeviationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DeviationDetailResponseDto> {
    return this.deviations.cancel(
      principal,
      deviationId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':deviationId/investigation/complete')
  @Permissions('deviations.investigate')
  @ApiCreatedResponse({ type: DeviationDetailResponseDto })
  completeInvestigation(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('deviationId', new ParseUUIDPipe()) deviationId: string,
    @Body() input: CompleteDeviationInvestigationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DeviationDetailResponseDto> {
    return this.deviations.completeInvestigation(
      principal,
      deviationId,
      input,
      requestMetadata(request),
    );
  }
}

function requestMetadata(
  request: Request & RequestWithContext,
): RequestMetadata {
  return {
    correlationId: request.correlationId,
    ipAddress: request.ip,
    userAgent: request.header('user-agent'),
  };
}

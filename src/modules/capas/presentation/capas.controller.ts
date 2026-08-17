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
import { CapasService } from '../application/capas.service.js';
import {
  CapaListQueryDto,
  CompleteCapaEffectivenessReviewDto,
  CompleteCapaActionDto,
  CreateCapaDto,
  ScheduleCapaEffectivenessReviewDto,
} from '../application/dto/capa-request.dto.js';
import {
  CapaDetailResponseDto,
  CapaSummaryResponseDto,
} from '../application/dto/capa-response.dto.js';

@ApiTags('CAPA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('capas')
export class CapasController {
  constructor(private readonly capas: CapasService) {}

  @Get()
  @Permissions('capas.read')
  @ApiOkResponse({ type: CapaSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: CapaListQueryDto,
  ): Promise<CapaSummaryResponseDto[]> {
    return this.capas.list(principal, query);
  }

  @Get(':capaId')
  @Permissions('capas.read')
  @ApiOkResponse({ type: CapaDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.get(principal, capaId);
  }

  @Post()
  @Permissions('capas.create')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateCapaDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.create(principal, input, requestMetadata(request));
  }

  @Post(':capaId/actions/:actionId/complete')
  @Permissions('capas.execute')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  completeAction(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Param('actionId', new ParseUUIDPipe()) actionId: string,
    @Body() input: CompleteCapaActionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.completeAction(
      principal,
      capaId,
      actionId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':capaId/effectiveness-review')
  @Permissions('capas.schedule_effectiveness')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  scheduleEffectivenessReview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Body() input: ScheduleCapaEffectivenessReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.scheduleEffectivenessReview(
      principal,
      capaId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':capaId/effectiveness-review/complete')
  @Permissions('capas.verify_effectiveness')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  completeEffectivenessReview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Body() input: CompleteCapaEffectivenessReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.completeEffectivenessReview(
      principal,
      capaId,
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

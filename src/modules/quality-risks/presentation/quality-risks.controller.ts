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
  CancelQualityRiskDto,
  CompleteQualityRiskItemDto,
  CreateQualityRiskDto,
  QualityRiskListQueryDto,
  ReviewQualityRiskDto,
} from '../application/dto/quality-risk-request.dto.js';
import {
  QualityRiskDetailResponseDto,
  QualityRiskParticipantResponseDto,
  QualityRiskReferencesResponseDto,
  QualityRiskSummaryResponseDto,
} from '../application/dto/quality-risk-response.dto.js';
import { QualityRisksService } from '../application/quality-risks.service.js';

@ApiTags('Quality risk management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('quality-risks')
export class QualityRisksController {
  constructor(private readonly qualityRisks: QualityRisksService) {}

  @Get()
  @Permissions('risks.read')
  @ApiOkResponse({ type: QualityRiskSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: QualityRiskListQueryDto,
  ): Promise<QualityRiskSummaryResponseDto[]> {
    return this.qualityRisks.list(principal, query);
  }

  @Get('participants')
  @Permissions('risks.create')
  @ApiOkResponse({ type: QualityRiskParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<QualityRiskParticipantResponseDto[]> {
    return this.qualityRisks.listParticipants(principal);
  }

  @Get('references')
  @Permissions('risks.create')
  @ApiOkResponse({ type: QualityRiskReferencesResponseDto })
  references(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<QualityRiskReferencesResponseDto> {
    return this.qualityRisks.references(principal);
  }

  @Get(':riskId')
  @Permissions('risks.read')
  @ApiOkResponse({ type: QualityRiskDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('riskId', new ParseUUIDPipe()) riskId: string,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.qualityRisks.get(principal, riskId);
  }

  @Post()
  @Permissions('risks.create')
  @ApiCreatedResponse({ type: QualityRiskDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateQualityRiskDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.qualityRisks.create(principal, input, requestMetadata(request));
  }

  @Post(':riskId/items/:itemId/complete')
  @Permissions('risks.mitigate')
  @ApiCreatedResponse({ type: QualityRiskDetailResponseDto })
  completeItem(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('riskId', new ParseUUIDPipe()) riskId: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: CompleteQualityRiskItemDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.qualityRisks.completeItem(
      principal,
      riskId,
      itemId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':riskId/review')
  @Permissions('risks.review')
  @ApiCreatedResponse({ type: QualityRiskDetailResponseDto })
  review(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('riskId', new ParseUUIDPipe()) riskId: string,
    @Body() input: ReviewQualityRiskDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.qualityRisks.review(
      principal,
      riskId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':riskId/cancel')
  @Permissions('risks.create')
  @ApiCreatedResponse({ type: QualityRiskDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('riskId', new ParseUUIDPipe()) riskId: string,
    @Body() input: CancelQualityRiskDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<QualityRiskDetailResponseDto> {
    return this.qualityRisks.cancel(
      principal,
      riskId,
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

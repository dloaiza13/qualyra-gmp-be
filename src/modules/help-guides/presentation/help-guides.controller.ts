import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreateHelpGuideDto,
  HelpGuideContextParamDto,
  HelpGuideFeedbackDto,
  HelpGuideListQueryDto,
  UpdateHelpGuideDto,
} from '../application/dto/help-guide-request.dto.js';
import {
  HelpGuideFeedbackResponseDto,
  ManagedHelpGuideResponseDto,
  PublishedHelpGuideResponseDto,
} from '../application/dto/help-guide-response.dto.js';
import { HelpGuidesService } from '../application/help-guides.service.js';

@ApiTags('Help guides')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('help-guides')
export class HelpGuidesController {
  constructor(private readonly helpGuides: HelpGuidesService) {}

  @Get('context/:context')
  @Permissions('help_guides.read')
  @ApiOkResponse({ type: PublishedHelpGuideResponseDto, isArray: true })
  contextual(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param() params: HelpGuideContextParamDto,
  ): Promise<PublishedHelpGuideResponseDto[]> {
    return this.helpGuides.contextual(principal, params.context);
  }

  @Get()
  @Permissions('help_guides.manage')
  @ApiOkResponse({ type: ManagedHelpGuideResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: HelpGuideListQueryDto,
  ): Promise<ManagedHelpGuideResponseDto[]> {
    return this.helpGuides.list(principal, query);
  }

  @Post()
  @Permissions('help_guides.manage')
  @ApiCreatedResponse({ type: ManagedHelpGuideResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateHelpGuideDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ManagedHelpGuideResponseDto> {
    return this.helpGuides.create(principal, input, requestMetadata(request));
  }

  @Patch(':guideId')
  @Permissions('help_guides.manage')
  @ApiOkResponse({ type: ManagedHelpGuideResponseDto })
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('guideId', new ParseUUIDPipe()) guideId: string,
    @Body() input: UpdateHelpGuideDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ManagedHelpGuideResponseDto> {
    return this.helpGuides.update(
      principal,
      guideId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':guideId/publish')
  @HttpCode(HttpStatus.OK)
  @Permissions('help_guides.publish')
  @ApiOkResponse({ type: ManagedHelpGuideResponseDto })
  publish(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('guideId', new ParseUUIDPipe()) guideId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<ManagedHelpGuideResponseDto> {
    return this.helpGuides.publish(
      principal,
      guideId,
      requestMetadata(request),
    );
  }

  @Post(':guideId/archive')
  @HttpCode(HttpStatus.OK)
  @Permissions('help_guides.publish')
  @ApiOkResponse({ type: ManagedHelpGuideResponseDto })
  archive(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('guideId', new ParseUUIDPipe()) guideId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<ManagedHelpGuideResponseDto> {
    return this.helpGuides.archive(
      principal,
      guideId,
      requestMetadata(request),
    );
  }

  @Post(':guideKey/feedback')
  @HttpCode(HttpStatus.OK)
  @Permissions('help_guides.read')
  @ApiOkResponse({ type: HelpGuideFeedbackResponseDto })
  feedback(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('guideKey') guideKey: string,
    @Body() input: HelpGuideFeedbackDto,
  ): Promise<HelpGuideFeedbackResponseDto> {
    return this.helpGuides.feedback(principal, guideKey, input.helpful);
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

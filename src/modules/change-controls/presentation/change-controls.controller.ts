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
import { ChangeControlsService } from '../application/change-controls.service.js';
import {
  AssessChangeControlDto,
  CancelChangeControlDto,
  ChangeControlListQueryDto,
  CompleteChangeTaskDto,
  CreateChangeControlDto,
  DecideChangeControlDto,
  VerifyChangeControlDto,
} from '../application/dto/change-control-request.dto.js';
import {
  ChangeControlDetailResponseDto,
  ChangeControlParticipantResponseDto,
  ChangeControlSummaryResponseDto,
} from '../application/dto/change-control-response.dto.js';

@ApiTags('Change controls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('change-controls')
export class ChangeControlsController {
  constructor(private readonly changeControls: ChangeControlsService) {}

  @Get()
  @Permissions('changes.read')
  @ApiOkResponse({ type: ChangeControlSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ChangeControlListQueryDto,
  ): Promise<ChangeControlSummaryResponseDto[]> {
    return this.changeControls.list(principal, query);
  }

  @Get('participants')
  @Permissions('changes.assess')
  @ApiOkResponse({ type: ChangeControlParticipantResponseDto, isArray: true })
  listParticipants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ChangeControlParticipantResponseDto[]> {
    return this.changeControls.listParticipants(principal);
  }

  @Get(':changeControlId')
  @Permissions('changes.read')
  @ApiOkResponse({ type: ChangeControlDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('changeControlId', new ParseUUIDPipe()) changeControlId: string,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.get(principal, changeControlId);
  }

  @Post()
  @Permissions('changes.create')
  @ApiCreatedResponse({ type: ChangeControlDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateChangeControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.create(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Post(':changeControlId/assessment')
  @Permissions('changes.assess')
  @ApiCreatedResponse({ type: ChangeControlDetailResponseDto })
  assess(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('changeControlId', new ParseUUIDPipe()) changeControlId: string,
    @Body() input: AssessChangeControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.assess(
      principal,
      changeControlId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':changeControlId/cancel')
  @Permissions('changes.assess')
  @ApiCreatedResponse({ type: ChangeControlDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('changeControlId', new ParseUUIDPipe()) changeControlId: string,
    @Body() input: CancelChangeControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.cancel(
      principal,
      changeControlId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':changeControlId/decision')
  @Permissions('changes.approve')
  @ApiCreatedResponse({ type: ChangeControlDetailResponseDto })
  decide(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('changeControlId', new ParseUUIDPipe()) changeControlId: string,
    @Body() input: DecideChangeControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.decide(
      principal,
      changeControlId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':changeControlId/tasks/:taskId/complete')
  @Permissions('changes.implement')
  @ApiCreatedResponse({ type: ChangeControlDetailResponseDto })
  completeTask(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('changeControlId', new ParseUUIDPipe()) changeControlId: string,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() input: CompleteChangeTaskDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.completeTask(
      principal,
      changeControlId,
      taskId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':changeControlId/verification')
  @Permissions('changes.verify')
  @ApiCreatedResponse({ type: ChangeControlDetailResponseDto })
  verify(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('changeControlId', new ParseUUIDPipe()) changeControlId: string,
    @Body() input: VerifyChangeControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ChangeControlDetailResponseDto> {
    return this.changeControls.verify(
      principal,
      changeControlId,
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

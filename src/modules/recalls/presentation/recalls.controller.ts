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
  CancelRecallDto,
  CloseRecallDto,
  CompleteRecallAssessmentDto,
  CreateRecallDto,
  DecideRecallDto,
  RecallListQueryDto,
  RecordRecallExecutionUpdateDto,
} from '../application/dto/recall-request.dto.js';
import {
  RecallDetailResponseDto,
  RecallParticipantResponseDto,
  RecallReferencesResponseDto,
  RecallSummaryResponseDto,
} from '../application/dto/recall-response.dto.js';
import { RecallsService } from '../application/recalls.service.js';

@ApiTags('Product recalls and field actions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('recalls')
export class RecallsController {
  constructor(private readonly recalls: RecallsService) {}

  @Get()
  @Permissions('recalls.read')
  @ApiOkResponse({ type: RecallSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: RecallListQueryDto,
  ): Promise<RecallSummaryResponseDto[]> {
    return this.recalls.list(principal, query);
  }

  @Get('participants')
  @Permissions('recalls.assess')
  @ApiOkResponse({ type: RecallParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<RecallParticipantResponseDto[]> {
    return this.recalls.listParticipants(principal);
  }

  @Get('references')
  @Permissions('recalls.read')
  @ApiOkResponse({ type: RecallReferencesResponseDto })
  references(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<RecallReferencesResponseDto> {
    return this.recalls.references(principal);
  }

  @Get(':recallId')
  @Permissions('recalls.read')
  @ApiOkResponse({ type: RecallDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('recallId', new ParseUUIDPipe()) recallId: string,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.get(principal, recallId);
  }

  @Post()
  @Permissions('recalls.create')
  @ApiCreatedResponse({ type: RecallDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateRecallDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.create(principal, input, requestMetadata(request));
  }

  @Post(':recallId/assessment')
  @Permissions('recalls.assess')
  @ApiCreatedResponse({ type: RecallDetailResponseDto })
  assess(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('recallId', new ParseUUIDPipe()) recallId: string,
    @Body() input: CompleteRecallAssessmentDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.assess(
      principal,
      recallId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':recallId/decision')
  @Permissions('recalls.approve')
  @ApiCreatedResponse({ type: RecallDetailResponseDto })
  decide(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('recallId', new ParseUUIDPipe()) recallId: string,
    @Body() input: DecideRecallDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.decide(
      principal,
      recallId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':recallId/execution-updates')
  @Permissions('recalls.execute')
  @ApiCreatedResponse({ type: RecallDetailResponseDto })
  recordExecutionUpdate(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('recallId', new ParseUUIDPipe()) recallId: string,
    @Body() input: RecordRecallExecutionUpdateDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.recordExecutionUpdate(
      principal,
      recallId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':recallId/closure')
  @Permissions('recalls.close')
  @ApiCreatedResponse({ type: RecallDetailResponseDto })
  close(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('recallId', new ParseUUIDPipe()) recallId: string,
    @Body() input: CloseRecallDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.close(
      principal,
      recallId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':recallId/cancellation')
  @Permissions('recalls.cancel')
  @ApiCreatedResponse({ type: RecallDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('recallId', new ParseUUIDPipe()) recallId: string,
    @Body() input: CancelRecallDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<RecallDetailResponseDto> {
    return this.recalls.cancel(
      principal,
      recallId,
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

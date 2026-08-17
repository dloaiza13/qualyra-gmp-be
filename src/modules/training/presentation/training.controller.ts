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
  CancelTrainingAssignmentDto,
  CompleteTrainingAssignmentDto,
  CreateTrainingAssignmentsDto,
  TrainingAssignmentListQueryDto,
} from '../application/dto/training-request.dto.js';
import {
  TrainingAssignmentDetailResponseDto,
  TrainingAssignmentSummaryResponseDto,
} from '../application/dto/training-response.dto.js';
import { TrainingService } from '../application/training.service.js';

@ApiTags('Training')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('training/assignments')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('my')
  @Permissions('training.read')
  @ApiOkResponse({ type: TrainingAssignmentSummaryResponseDto, isArray: true })
  listMine(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: TrainingAssignmentListQueryDto,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.training.listMine(principal, query);
  }

  @Get()
  @Permissions('training.assign')
  @ApiOkResponse({ type: TrainingAssignmentSummaryResponseDto, isArray: true })
  listAll(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: TrainingAssignmentListQueryDto,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.training.listAll(principal, query);
  }

  @Get(':assignmentId')
  @Permissions('training.read')
  @ApiOkResponse({ type: TrainingAssignmentDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
  ): Promise<TrainingAssignmentDetailResponseDto> {
    return this.training.get(principal, assignmentId);
  }

  @Post()
  @Permissions('training.assign')
  @ApiCreatedResponse({
    type: TrainingAssignmentSummaryResponseDto,
    isArray: true,
  })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateTrainingAssignmentsDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<TrainingAssignmentSummaryResponseDto[]> {
    return this.training.create(principal, input, requestMetadata(request));
  }

  @Post(':assignmentId/complete')
  @Permissions('training.complete')
  @ApiCreatedResponse({ type: TrainingAssignmentDetailResponseDto })
  complete(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: CompleteTrainingAssignmentDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<TrainingAssignmentDetailResponseDto> {
    return this.training.complete(
      principal,
      assignmentId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':assignmentId/cancel')
  @Permissions('training.assign')
  @ApiCreatedResponse({ type: TrainingAssignmentDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
    @Body() input: CancelTrainingAssignmentDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<TrainingAssignmentDetailResponseDto> {
    return this.training.cancel(
      principal,
      assignmentId,
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

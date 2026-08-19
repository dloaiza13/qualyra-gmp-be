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
import { AuditsService } from '../application/audits.service.js';
import {
  AddAuditFindingDto,
  AuditListQueryDto,
  CancelAuditDto,
  CloseAuditDto,
  CompleteAuditReportDto,
  CreateAuditDto,
  ReviewFindingResponseDto,
  SubmitFindingResponseDto,
} from '../application/dto/audit-request.dto.js';
import {
  AuditDetailResponseDto,
  AuditParticipantResponseDto,
  AuditSummaryResponseDto,
} from '../application/dto/audit-response.dto.js';

@ApiTags('GMP audits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audits')
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  @Get()
  @Permissions('audits.read')
  @ApiOkResponse({ type: AuditSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: AuditListQueryDto,
  ): Promise<AuditSummaryResponseDto[]> {
    return this.audits.list(principal, query);
  }

  @Get('participants')
  @Permissions('audits.plan')
  @ApiOkResponse({ type: AuditParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<AuditParticipantResponseDto[]> {
    return this.audits.listParticipants(principal);
  }

  @Get(':auditId')
  @Permissions('audits.read')
  @ApiOkResponse({ type: AuditDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.get(principal, auditId);
  }

  @Post()
  @Permissions('audits.plan')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateAuditDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.create(principal, input, requestMetadata(request));
  }

  @Post(':auditId/start')
  @Permissions('audits.execute')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  start(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.start(principal, auditId, requestMetadata(request));
  }

  @Post(':auditId/findings')
  @Permissions('audits.execute')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  addFinding(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() input: AddAuditFindingDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.addFinding(
      principal,
      auditId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':auditId/report')
  @Permissions('audits.execute')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  completeReport(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() input: CompleteAuditReportDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.completeReport(
      principal,
      auditId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':auditId/findings/:findingId/responses')
  @Permissions('audits.respond')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  submitResponse(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('findingId', new ParseUUIDPipe()) findingId: string,
    @Body() input: SubmitFindingResponseDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.submitResponse(
      principal,
      auditId,
      findingId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':auditId/findings/:findingId/responses/:responseId/review')
  @Permissions('audits.review')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  reviewResponse(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Param('findingId', new ParseUUIDPipe()) findingId: string,
    @Param('responseId', new ParseUUIDPipe()) responseId: string,
    @Body() input: ReviewFindingResponseDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.reviewResponse(
      principal,
      auditId,
      findingId,
      responseId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':auditId/closure')
  @Permissions('audits.close')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  close(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() input: CloseAuditDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.close(
      principal,
      auditId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':auditId/cancel')
  @Permissions('audits.plan')
  @ApiCreatedResponse({ type: AuditDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
    @Body() input: CancelAuditDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<AuditDetailResponseDto> {
    return this.audits.cancel(
      principal,
      auditId,
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

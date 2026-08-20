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
  CancelComplaintDto,
  ComplaintListQueryDto,
  CompleteComplaintInvestigationDto,
  CreateComplaintDto,
  DecideComplaintDto,
  TriageComplaintDto,
} from '../application/dto/complaint-request.dto.js';
import {
  ComplaintDetailResponseDto,
  ComplaintParticipantResponseDto,
  ComplaintReferencesResponseDto,
  ComplaintSummaryResponseDto,
} from '../application/dto/complaint-response.dto.js';
import { ComplaintsService } from '../application/complaints.service.js';

@ApiTags('Product quality complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @Permissions('complaints.read')
  @ApiOkResponse({ type: ComplaintSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ComplaintListQueryDto,
  ): Promise<ComplaintSummaryResponseDto[]> {
    return this.complaints.list(principal, query);
  }

  @Get('participants')
  @Permissions('complaints.triage')
  @ApiOkResponse({ type: ComplaintParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplaintParticipantResponseDto[]> {
    return this.complaints.listParticipants(principal);
  }

  @Get('references')
  @Permissions('complaints.read')
  @ApiOkResponse({ type: ComplaintReferencesResponseDto })
  references(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplaintReferencesResponseDto> {
    return this.complaints.references(principal);
  }

  @Get(':complaintId')
  @Permissions('complaints.read')
  @ApiOkResponse({ type: ComplaintDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('complaintId', new ParseUUIDPipe()) complaintId: string,
  ): Promise<ComplaintDetailResponseDto> {
    return this.complaints.get(principal, complaintId);
  }

  @Post()
  @Permissions('complaints.create')
  @ApiCreatedResponse({ type: ComplaintDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateComplaintDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplaintDetailResponseDto> {
    return this.complaints.create(principal, input, requestMetadata(request));
  }

  @Post(':complaintId/triage')
  @Permissions('complaints.triage')
  @ApiCreatedResponse({ type: ComplaintDetailResponseDto })
  triage(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('complaintId', new ParseUUIDPipe()) complaintId: string,
    @Body() input: TriageComplaintDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplaintDetailResponseDto> {
    return this.complaints.triage(
      principal,
      complaintId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':complaintId/investigation')
  @Permissions('complaints.investigate')
  @ApiCreatedResponse({ type: ComplaintDetailResponseDto })
  investigate(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('complaintId', new ParseUUIDPipe()) complaintId: string,
    @Body() input: CompleteComplaintInvestigationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplaintDetailResponseDto> {
    return this.complaints.completeInvestigation(
      principal,
      complaintId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':complaintId/decision')
  @Permissions('complaints.review')
  @ApiCreatedResponse({ type: ComplaintDetailResponseDto })
  decide(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('complaintId', new ParseUUIDPipe()) complaintId: string,
    @Body() input: DecideComplaintDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplaintDetailResponseDto> {
    return this.complaints.decide(
      principal,
      complaintId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':complaintId/cancellation')
  @Permissions('complaints.cancel')
  @ApiCreatedResponse({ type: ComplaintDetailResponseDto })
  cancel(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('complaintId', new ParseUUIDPipe()) complaintId: string,
    @Body() input: CancelComplaintDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplaintDetailResponseDto> {
    return this.complaints.cancel(
      principal,
      complaintId,
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

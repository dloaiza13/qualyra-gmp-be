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
  CreateDocumentDto,
  CreateDocumentVersionDto,
  DocumentDecisionDto,
  DocumentListQueryDto,
  RequestDocumentReviewDto,
} from '../application/dto/document-request.dto.js';
import {
  DocumentDetailResponseDto,
  DocumentSummaryResponseDto,
} from '../application/dto/document-response.dto.js';
import { DocumentsService } from '../application/documents.service.js';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @Permissions('documents.read')
  @ApiOkResponse({ type: DocumentSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: DocumentListQueryDto,
  ): Promise<DocumentSummaryResponseDto[]> {
    return this.documents.list(principal, query);
  }

  @Get(':documentId')
  @Permissions('documents.read')
  @ApiOkResponse({ type: DocumentDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.get(principal, documentId);
  }

  @Post()
  @Permissions('documents.create')
  @ApiCreatedResponse({ type: DocumentDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateDocumentDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.create(principal, input, requestMetadata(request));
  }

  @Post(':documentId/versions')
  @Permissions('documents.update')
  @ApiCreatedResponse({ type: DocumentDetailResponseDto })
  createVersion(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() input: CreateDocumentVersionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.createVersion(
      principal,
      documentId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':documentId/review-request')
  @Permissions('documents.update')
  @ApiCreatedResponse({ type: DocumentDetailResponseDto })
  requestReview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() input: RequestDocumentReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.requestReview(
      principal,
      documentId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':documentId/review-decision')
  @Permissions('documents.review')
  @ApiCreatedResponse({ type: DocumentDetailResponseDto })
  reviewDecision(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() input: DocumentDecisionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.reviewDecision(
      principal,
      documentId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':documentId/approval-decision')
  @Permissions('documents.approve')
  @ApiCreatedResponse({ type: DocumentDetailResponseDto })
  approvalDecision(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() input: DocumentDecisionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<DocumentDetailResponseDto> {
    return this.documents.approvalDecision(
      principal,
      documentId,
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

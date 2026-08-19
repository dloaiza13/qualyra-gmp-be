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
  CompleteSupplierQualificationDto,
  CreateSupplierDto,
  CreateSupplierScarDto,
  DecideSupplierQualificationDto,
  ReviewSupplierScarResponseDto,
  SubmitSupplierScarResponseDto,
  SupplierListQueryDto,
} from '../application/dto/supplier-request.dto.js';
import {
  SupplierDetailResponseDto,
  SupplierParticipantResponseDto,
  SupplierReferencesResponseDto,
  SupplierSummaryResponseDto,
} from '../application/dto/supplier-response.dto.js';
import { SuppliersService } from '../application/suppliers.service.js';

@ApiTags('Supplier quality management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Permissions('suppliers.read')
  @ApiOkResponse({ type: SupplierSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: SupplierListQueryDto,
  ): Promise<SupplierSummaryResponseDto[]> {
    return this.suppliers.list(principal, query);
  }

  @Get('participants')
  @Permissions('suppliers.create')
  @ApiOkResponse({ type: SupplierParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<SupplierParticipantResponseDto[]> {
    return this.suppliers.listParticipants(principal);
  }

  @Get('references')
  @Permissions('suppliers.create')
  @ApiOkResponse({ type: SupplierReferencesResponseDto })
  references(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<SupplierReferencesResponseDto> {
    return this.suppliers.references(principal);
  }

  @Get(':supplierId')
  @Permissions('suppliers.read')
  @ApiOkResponse({ type: SupplierDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.get(principal, supplierId);
  }

  @Post()
  @Permissions('suppliers.create')
  @ApiCreatedResponse({ type: SupplierDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateSupplierDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.create(principal, input, requestMetadata(request));
  }

  @Post(':supplierId/qualifications')
  @Permissions('suppliers.assess')
  @ApiCreatedResponse({ type: SupplierDetailResponseDto })
  qualify(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Body() input: CompleteSupplierQualificationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.qualify(
      principal,
      supplierId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':supplierId/qualifications/:qualificationId/decision')
  @Permissions('suppliers.approve')
  @ApiCreatedResponse({ type: SupplierDetailResponseDto })
  decideQualification(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string,
    @Body() input: DecideSupplierQualificationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.decideQualification(
      principal,
      supplierId,
      qualificationId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':supplierId/scars')
  @Permissions('suppliers.scar')
  @ApiCreatedResponse({ type: SupplierDetailResponseDto })
  createScar(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Body() input: CreateSupplierScarDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.createScar(
      principal,
      supplierId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':supplierId/scars/:scarId/responses')
  @Permissions('suppliers.scar')
  @ApiCreatedResponse({ type: SupplierDetailResponseDto })
  submitScarResponse(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Param('scarId', new ParseUUIDPipe()) scarId: string,
    @Body() input: SubmitSupplierScarResponseDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.submitScarResponse(
      principal,
      supplierId,
      scarId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':supplierId/scars/:scarId/responses/:responseId/review')
  @Permissions('suppliers.review_scar')
  @ApiCreatedResponse({ type: SupplierDetailResponseDto })
  reviewScarResponse(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('supplierId', new ParseUUIDPipe()) supplierId: string,
    @Param('scarId', new ParseUUIDPipe()) scarId: string,
    @Param('responseId', new ParseUUIDPipe()) responseId: string,
    @Body() input: ReviewSupplierScarResponseDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SupplierDetailResponseDto> {
    return this.suppliers.reviewScarResponse(
      principal,
      supplierId,
      scarId,
      responseId,
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

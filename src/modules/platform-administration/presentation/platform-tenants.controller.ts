import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import {
  PlatformAuditEventQueryDto,
  CreatePlatformTenantDto,
  ProcessBillingProviderEventDto,
  PlatformTenantQueryDto,
  UpdatePlatformSubscriptionDto,
  UpdatePlatformTenantDto,
} from '../application/dto/platform-tenant-request.dto.js';
import {
  PlatformAuditEventPageResponseDto,
  BillingProviderEventReceiptDto,
  PlatformTenantPageResponseDto,
  PlatformTenantResponseDto,
} from '../application/dto/platform-tenant-response.dto.js';
import { PlatformTenantsService } from '../application/platform-tenants.service.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { SubscriptionResponseDto } from '../../subscriptions/application/dto/subscription-response.dto.js';

@ApiTags('Platform administration')
@ApiSecurity('platformBearer')
@UseGuards(PlatformAdminGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('platform')
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Post('tenants')
  @ApiCreatedResponse({ type: PlatformTenantResponseDto })
  create(
    @Body() input: CreatePlatformTenantDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<PlatformTenantResponseDto> {
    return this.tenants.create(input, requestMetadata(request));
  }

  @Get('tenants')
  @ApiOkResponse({ type: PlatformTenantPageResponseDto })
  list(
    @Query() query: PlatformTenantQueryDto,
  ): Promise<PlatformTenantPageResponseDto> {
    return this.tenants.list(query);
  }

  @Get('tenants/:tenantId')
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  get(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
  ): Promise<PlatformTenantResponseDto> {
    return this.tenants.get(tenantId);
  }

  @Patch('tenants/:tenantId')
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  update(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() input: UpdatePlatformTenantDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<PlatformTenantResponseDto> {
    return this.tenants.update(tenantId, input, requestMetadata(request));
  }

  @Patch('tenants/:tenantId/subscription')
  @ApiOkResponse({ type: SubscriptionResponseDto })
  updateSubscription(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() input: UpdatePlatformSubscriptionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<SubscriptionResponseDto> {
    return this.tenants.updateSubscription(
      tenantId,
      input,
      requestMetadata(request),
    );
  }

  @Post('tenants/:tenantId/billing-events')
  @ApiCreatedResponse({ type: BillingProviderEventReceiptDto })
  processBillingProviderEvent(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() input: ProcessBillingProviderEventDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<BillingProviderEventReceiptDto> {
    return this.tenants.processBillingProviderEvent(
      tenantId,
      input,
      requestMetadata(request),
    );
  }

  @Get('audit-events')
  @ApiOkResponse({ type: PlatformAuditEventPageResponseDto })
  listAuditEvents(
    @Query() query: PlatformAuditEventQueryDto,
  ): Promise<PlatformAuditEventPageResponseDto> {
    return this.tenants.listAuditEvents(query);
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

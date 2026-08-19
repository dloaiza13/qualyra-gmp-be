import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  NotificationDeliveryQueryDto,
  NotificationDeliveryResponseDto,
} from '../application/dto/notification-delivery.dto.js';
import { NotificationOutboxService } from '../application/notification-outbox.service.js';

@ApiTags('Notification deliveries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notification-deliveries')
export class NotificationDeliveriesController {
  constructor(private readonly outbox: NotificationOutboxService) {}

  @Get()
  @Permissions('notifications.read')
  @ApiOkResponse({ type: NotificationDeliveryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: NotificationDeliveryQueryDto,
  ): Promise<NotificationDeliveryResponseDto[]> {
    return this.outbox.list(principal, query);
  }

  @Post(':deliveryId/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions('notifications.retry')
  @ApiOkResponse({ type: NotificationDeliveryResponseDto })
  retry(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string,
    @Req() request: Request & RequestWithContext,
  ): Promise<NotificationDeliveryResponseDto> {
    return this.outbox.retry(principal, deliveryId, requestMetadata(request));
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

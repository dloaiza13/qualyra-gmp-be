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
  CompleteCalibrationDto,
  CompleteMaintenanceDto,
  CreateEquipmentDto,
  EquipmentListQueryDto,
  RetireEquipmentDto,
  ReviewEquipmentRecordDto,
} from '../application/dto/equipment-request.dto.js';
import {
  EquipmentDetailResponseDto,
  EquipmentParticipantResponseDto,
  EquipmentSummaryResponseDto,
} from '../application/dto/equipment-response.dto.js';
import { EquipmentService } from '../application/equipment.service.js';

@ApiTags('GMP equipment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  @Permissions('equipment.read')
  @ApiOkResponse({ type: EquipmentSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: EquipmentListQueryDto,
  ): Promise<EquipmentSummaryResponseDto[]> {
    return this.equipment.list(principal, query);
  }

  @Get('participants')
  @Permissions('equipment.create')
  @ApiOkResponse({ type: EquipmentParticipantResponseDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<EquipmentParticipantResponseDto[]> {
    return this.equipment.listParticipants(principal);
  }

  @Get(':equipmentId')
  @Permissions('equipment.read')
  @ApiOkResponse({ type: EquipmentDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('equipmentId', new ParseUUIDPipe()) equipmentId: string,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.get(principal, equipmentId);
  }

  @Post()
  @Permissions('equipment.create')
  @ApiCreatedResponse({ type: EquipmentDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateEquipmentDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.create(principal, input, requestMetadata(request));
  }

  @Post(':equipmentId/calibrations')
  @Permissions('equipment.calibrate')
  @ApiCreatedResponse({ type: EquipmentDetailResponseDto })
  completeCalibration(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('equipmentId', new ParseUUIDPipe()) equipmentId: string,
    @Body() input: CompleteCalibrationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.completeCalibration(
      principal,
      equipmentId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':equipmentId/calibrations/:calibrationId/review')
  @Permissions('equipment.verify')
  @ApiCreatedResponse({ type: EquipmentDetailResponseDto })
  reviewCalibration(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('equipmentId', new ParseUUIDPipe()) equipmentId: string,
    @Param('calibrationId', new ParseUUIDPipe()) calibrationId: string,
    @Body() input: ReviewEquipmentRecordDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.reviewCalibration(
      principal,
      equipmentId,
      calibrationId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':equipmentId/maintenances')
  @Permissions('equipment.maintain')
  @ApiCreatedResponse({ type: EquipmentDetailResponseDto })
  completeMaintenance(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('equipmentId', new ParseUUIDPipe()) equipmentId: string,
    @Body() input: CompleteMaintenanceDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.completeMaintenance(
      principal,
      equipmentId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':equipmentId/maintenances/:maintenanceId/review')
  @Permissions('equipment.verify')
  @ApiCreatedResponse({ type: EquipmentDetailResponseDto })
  reviewMaintenance(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('equipmentId', new ParseUUIDPipe()) equipmentId: string,
    @Param('maintenanceId', new ParseUUIDPipe()) maintenanceId: string,
    @Body() input: ReviewEquipmentRecordDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.reviewMaintenance(
      principal,
      equipmentId,
      maintenanceId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':equipmentId/retirement')
  @Permissions('equipment.retire')
  @ApiCreatedResponse({ type: EquipmentDetailResponseDto })
  retire(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('equipmentId', new ParseUUIDPipe()) equipmentId: string,
    @Body() input: RetireEquipmentDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<EquipmentDetailResponseDto> {
    return this.equipment.retire(
      principal,
      equipmentId,
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

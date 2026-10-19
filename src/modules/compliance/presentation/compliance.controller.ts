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
import { ComplianceService } from '../application/compliance.service.js';
import {
  ComplianceFindingListQueryDto,
  CreateComplianceControlDto,
  CreateComplianceEvidenceDto,
  CreateComplianceFindingDto,
  CreateComplianceFrameworkDto,
  CreateComplianceRequirementDto,
  UpdateComplianceFindingStatusDto,
} from '../application/dto/compliance-request.dto.js';
import {
  ComplianceControlResponseDto,
  ComplianceEvidenceResponseDto,
  ComplianceFindingResponseDto,
  ComplianceFrameworkResponseDto,
  ComplianceOverviewResponseDto,
} from '../application/dto/compliance-response.dto.js';

@ApiTags('Continuous compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('overview')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceOverviewResponseDto })
  overview(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceOverviewResponseDto> {
    return this.compliance.overview(principal);
  }

  @Get('frameworks')
  @Permissions('compliance.frameworks.read')
  @ApiOkResponse({ type: ComplianceFrameworkResponseDto, isArray: true })
  frameworks(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceFrameworkResponseDto[]> {
    return this.compliance.listFrameworks(principal);
  }

  @Post('frameworks')
  @Permissions('compliance.frameworks.manage')
  @ApiCreatedResponse({ type: ComplianceFrameworkResponseDto })
  createFramework(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateComplianceFrameworkDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceFrameworkResponseDto> {
    return this.compliance.createFramework(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Post('frameworks/:frameworkId/requirements')
  @Permissions('compliance.frameworks.manage')
  @ApiCreatedResponse({ type: ComplianceFrameworkResponseDto })
  createRequirement(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('frameworkId', new ParseUUIDPipe()) frameworkId: string,
    @Body() input: CreateComplianceRequirementDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceFrameworkResponseDto> {
    return this.compliance.createRequirement(
      principal,
      frameworkId,
      input,
      requestMetadata(request),
    );
  }

  @Get('controls')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceControlResponseDto, isArray: true })
  controls(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceControlResponseDto[]> {
    return this.compliance.listControls(principal);
  }

  @Post('controls')
  @Permissions('compliance.manage')
  @ApiCreatedResponse({ type: ComplianceControlResponseDto })
  createControl(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateComplianceControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceControlResponseDto> {
    return this.compliance.createControl(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Get('evidence')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceEvidenceResponseDto, isArray: true })
  evidence(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceEvidenceResponseDto[]> {
    return this.compliance.listEvidence(principal);
  }

  @Post('evidence')
  @Permissions('compliance.manage')
  @ApiCreatedResponse({ type: ComplianceEvidenceResponseDto })
  createEvidence(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateComplianceEvidenceDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceEvidenceResponseDto> {
    return this.compliance.createEvidence(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Get('findings')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceFindingResponseDto, isArray: true })
  findings(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ComplianceFindingListQueryDto,
  ): Promise<ComplianceFindingResponseDto[]> {
    return this.compliance.listFindings(principal, query);
  }

  @Post('findings')
  @Permissions('compliance.findings.manage')
  @ApiCreatedResponse({ type: ComplianceFindingResponseDto })
  createFinding(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateComplianceFindingDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceFindingResponseDto> {
    return this.compliance.createFinding(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Patch('findings/:findingId/status')
  @Permissions('compliance.findings.manage')
  @ApiOkResponse({ type: ComplianceFindingResponseDto })
  updateFindingStatus(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('findingId', new ParseUUIDPipe()) findingId: string,
    @Body() input: UpdateComplianceFindingStatusDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceFindingResponseDto> {
    return this.compliance.updateFindingStatus(
      principal,
      findingId,
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

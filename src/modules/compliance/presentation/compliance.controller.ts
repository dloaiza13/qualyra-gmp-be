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
import { ComplianceEvaluationService } from '../application/compliance-evaluation.service.js';
import { ComplianceReadinessService } from '../application/compliance-readiness.service.js';
import {
  ComplianceEvaluationListQueryDto,
  ComplianceEvidenceListQueryDto,
  ComplianceSourceParamsDto,
  ComplianceFindingListQueryDto,
  ComplianceSnapshotListQueryDto,
  CreateComplianceControlDto,
  CreateComplianceEvidenceDto,
  CreateComplianceFindingDto,
  CreateComplianceFrameworkDto,
  CreateComplianceRequirementDto,
  CreateComplianceRuleDto,
  RunComplianceEvaluationDto,
  UpdateComplianceRuleDto,
  UpdateComplianceFindingStatusDto,
  UpdateComplianceReadinessPolicyDto,
  UpdateComplianceControlDto,
  UpdateComplianceFrameworkDto,
} from '../application/dto/compliance-request.dto.js';
import {
  ComplianceControlResponseDto,
  ComplianceEvidenceResponseDto,
  ComplianceEvaluationRunResponseDto,
  ComplianceFindingResponseDto,
  ComplianceFrameworkResponseDto,
  ComplianceOverviewResponseDto,
  ComplianceReadinessPolicyResponseDto,
  ComplianceReadinessResponseDto,
  ComplianceRuleCatalogResponseDto,
  ComplianceRuleResponseDto,
  ComplianceScoreSnapshotResponseDto,
  ComplianceSourceLocationResponseDto,
  ComplianceUserSummaryDto,
} from '../application/dto/compliance-response.dto.js';

@ApiTags('Continuous compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly evaluations: ComplianceEvaluationService,
    private readonly readiness: ComplianceReadinessService,
  ) {}

  @Get('overview')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceOverviewResponseDto })
  overview(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceOverviewResponseDto> {
    return this.compliance.overview(principal);
  }

  @Get('readiness')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceReadinessResponseDto })
  auditReadiness(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceReadinessResponseDto> {
    return this.readiness.getReadiness(principal);
  }

  @Get('readiness/policy')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceReadinessPolicyResponseDto })
  readinessPolicy(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceReadinessPolicyResponseDto> {
    return this.readiness.getPolicy(principal);
  }

  @Patch('readiness/policy')
  @Permissions('compliance.manage')
  @ApiOkResponse({ type: ComplianceReadinessPolicyResponseDto })
  updateReadinessPolicy(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: UpdateComplianceReadinessPolicyDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceReadinessPolicyResponseDto> {
    return this.readiness.updatePolicy(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Get('readiness/snapshots')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceScoreSnapshotResponseDto, isArray: true })
  readinessSnapshots(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ComplianceSnapshotListQueryDto,
  ): Promise<ComplianceScoreSnapshotResponseDto[]> {
    return this.readiness.listSnapshots(principal, query);
  }

  @Post('readiness/snapshots')
  @Permissions('compliance.evaluate')
  @ApiCreatedResponse({ type: ComplianceScoreSnapshotResponseDto })
  captureReadinessSnapshot(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceScoreSnapshotResponseDto> {
    return this.readiness.captureSnapshot(principal, requestMetadata(request));
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

  @Patch('frameworks/:frameworkId')
  @Permissions('compliance.frameworks.manage')
  @ApiOkResponse({ type: ComplianceFrameworkResponseDto })
  updateFramework(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('frameworkId', new ParseUUIDPipe()) frameworkId: string,
    @Body() input: UpdateComplianceFrameworkDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceFrameworkResponseDto> {
    return this.compliance.updateFramework(
      principal,
      frameworkId,
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

  @Get('rule-catalog')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceRuleCatalogResponseDto, isArray: true })
  ruleCatalog(): ComplianceRuleCatalogResponseDto[] {
    return this.evaluations.catalog();
  }

  @Get('rules')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceRuleResponseDto, isArray: true })
  rules(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceRuleResponseDto[]> {
    return this.evaluations.listRules(principal);
  }

  @Post('rules')
  @Permissions('compliance.manage')
  @ApiCreatedResponse({ type: ComplianceRuleResponseDto })
  createRule(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateComplianceRuleDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceRuleResponseDto> {
    return this.evaluations.createRule(
      principal,
      input,
      requestMetadata(request),
    );
  }

  @Patch('rules/:ruleId')
  @Permissions('compliance.manage')
  @ApiOkResponse({ type: ComplianceRuleResponseDto })
  updateRule(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('ruleId', new ParseUUIDPipe()) ruleId: string,
    @Body() input: UpdateComplianceRuleDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceRuleResponseDto> {
    return this.evaluations.updateRule(
      principal,
      ruleId,
      input,
      requestMetadata(request),
    );
  }

  @Get('evaluations')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceEvaluationRunResponseDto, isArray: true })
  listEvaluations(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ComplianceEvaluationListQueryDto,
  ): Promise<ComplianceEvaluationRunResponseDto[]> {
    return this.evaluations.listEvaluations(principal, query);
  }

  @Get('evaluations/:evaluationId')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceEvaluationRunResponseDto })
  getEvaluation(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('evaluationId', new ParseUUIDPipe()) evaluationId: string,
  ): Promise<ComplianceEvaluationRunResponseDto> {
    return this.evaluations.getEvaluation(principal, evaluationId);
  }

  @Post('evaluations')
  @Permissions('compliance.evaluate')
  @ApiCreatedResponse({ type: ComplianceEvaluationRunResponseDto })
  runEvaluation(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: RunComplianceEvaluationDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceEvaluationRunResponseDto> {
    return this.evaluations.evaluate(
      principal,
      input,
      requestMetadata(request),
    );
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
    @Query() query: ComplianceEvidenceListQueryDto,
  ): Promise<ComplianceEvidenceResponseDto[]> {
    return this.compliance.listEvidence(principal, query);
  }

  @Get('sources/:sourceType/:sourceId')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceSourceLocationResponseDto })
  sourceLocation(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param() params: ComplianceSourceParamsDto,
  ): Promise<ComplianceSourceLocationResponseDto> {
    return this.compliance.sourceLocation(
      principal,
      params.sourceType,
      params.sourceId,
    );
  }

  @Patch('controls/:controlId')
  @Permissions('compliance.manage')
  @ApiOkResponse({ type: ComplianceControlResponseDto })
  updateControl(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('controlId', new ParseUUIDPipe()) controlId: string,
    @Body() input: UpdateComplianceControlDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<ComplianceControlResponseDto> {
    return this.compliance.updateControl(
      principal,
      controlId,
      input,
      requestMetadata(request),
    );
  }

  @Get('finding-categories')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: String, isArray: true })
  findingCategories(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<string[]> {
    return this.compliance.findingCategories(principal);
  }

  @Get('participants')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceUserSummaryDto, isArray: true })
  participants(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ComplianceUserSummaryDto[]> {
    return this.compliance.participants(principal);
  }

  @Get('findings/:findingId')
  @Permissions('compliance.read')
  @ApiOkResponse({ type: ComplianceFindingResponseDto })
  finding(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('findingId', new ParseUUIDPipe()) findingId: string,
  ): Promise<ComplianceFindingResponseDto> {
    return this.compliance.getFinding(principal, findingId);
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

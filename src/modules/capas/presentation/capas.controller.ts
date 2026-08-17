import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import { CapasService } from '../application/capas.service.js';
import {
  CapaEvidenceService,
  type UploadedEvidenceFile,
} from '../application/capa-evidence.service.js';
import {
  CapaListQueryDto,
  ApproveCapaActionExtensionDto,
  CompleteCapaEffectivenessReviewDto,
  CompleteCapaActionDto,
  CreateCapaDto,
  CreateCapaFollowUpCycleDto,
  ScheduleCapaEffectivenessReviewDto,
} from '../application/dto/capa-request.dto.js';
import {
  CapaDetailResponseDto,
  CapaAnalyticsResponseDto,
  CapaEvidenceUploadResponseDto,
  CapaSummaryResponseDto,
} from '../application/dto/capa-response.dto.js';

@ApiTags('CAPA')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('capas')
export class CapasController {
  constructor(
    private readonly capas: CapasService,
    private readonly evidence: CapaEvidenceService,
  ) {}

  @Get()
  @Permissions('capas.read')
  @ApiOkResponse({ type: CapaSummaryResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: CapaListQueryDto,
  ): Promise<CapaSummaryResponseDto[]> {
    return this.capas.list(principal, query);
  }

  @Get('analytics')
  @Permissions('capas.read')
  @ApiOkResponse({ type: CapaAnalyticsResponseDto })
  analytics(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<CapaAnalyticsResponseDto> {
    return this.capas.analytics(principal);
  }

  @Post(':capaId/actions/:actionId/evidence')
  @Permissions('capas.execute')
  @UseInterceptors(
    FileInterceptor('file', { limits: { files: 1, fileSize: 26_214_400 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: CapaEvidenceUploadResponseDto })
  uploadEvidence(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Param('actionId', new ParseUUIDPipe()) actionId: string,
    @UploadedFile() file: UploadedEvidenceFile | undefined,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaEvidenceUploadResponseDto> {
    return this.evidence.upload(
      principal,
      capaId,
      actionId,
      file,
      requestMetadata(request),
    );
  }

  @Get(':capaId/evidence/:evidenceId/download')
  @Permissions('capas.read')
  async downloadEvidence(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.evidence.download(principal, capaId, evidenceId);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.bytes.length));
    response.setHeader(
      'Content-Disposition',
      contentDisposition(file.fileName),
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes);
  }

  @Post(':capaId/follow-up-cycles')
  @Permissions('capas.create_follow_up')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  createFollowUpCycle(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Body() input: CreateCapaFollowUpCycleDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.createFollowUpCycle(
      principal,
      capaId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':capaId/actions/:actionId/extensions')
  @Permissions('capas.approve_extensions')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  approveActionExtension(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Param('actionId', new ParseUUIDPipe()) actionId: string,
    @Body() input: ApproveCapaActionExtensionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.approveActionExtension(
      principal,
      capaId,
      actionId,
      input,
      requestMetadata(request),
    );
  }

  @Get(':capaId')
  @Permissions('capas.read')
  @ApiOkResponse({ type: CapaDetailResponseDto })
  get(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.get(principal, capaId);
  }

  @Post()
  @Permissions('capas.create')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: CreateCapaDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.create(principal, input, requestMetadata(request));
  }

  @Post(':capaId/actions/:actionId/complete')
  @Permissions('capas.execute')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  completeAction(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Param('actionId', new ParseUUIDPipe()) actionId: string,
    @Body() input: CompleteCapaActionDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.completeAction(
      principal,
      capaId,
      actionId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':capaId/effectiveness-review')
  @Permissions('capas.schedule_effectiveness')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  scheduleEffectivenessReview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Body() input: ScheduleCapaEffectivenessReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.scheduleEffectivenessReview(
      principal,
      capaId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':capaId/effectiveness-review/complete')
  @Permissions('capas.verify_effectiveness')
  @ApiCreatedResponse({ type: CapaDetailResponseDto })
  completeEffectivenessReview(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('capaId', new ParseUUIDPipe()) capaId: string,
    @Body() input: CompleteCapaEffectivenessReviewDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<CapaDetailResponseDto> {
    return this.capas.completeEffectivenessReview(
      principal,
      capaId,
      input,
      requestMetadata(request),
    );
  }
}

function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
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

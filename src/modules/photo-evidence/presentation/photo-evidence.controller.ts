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
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  PhotoEvidenceSubjectQueryDto,
  UploadPhotoEvidenceDto,
} from '../application/dto/photo-evidence-request.dto.js';
import {
  PhotoEvidenceResponseDto,
  PhotoEvidenceUsageResponseDto,
} from '../application/dto/photo-evidence-response.dto.js';
import {
  PhotoEvidenceService,
  type UploadedPhotoFile,
} from '../application/photo-evidence.service.js';

@ApiTags('Photographic evidence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('photo-evidence')
export class PhotoEvidenceController {
  constructor(private readonly evidence: PhotoEvidenceService) {}

  @Get()
  @Permissions('photo_evidence.read')
  @ApiOkResponse({ type: PhotoEvidenceResponseDto, isArray: true })
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: PhotoEvidenceSubjectQueryDto,
  ): Promise<PhotoEvidenceResponseDto[]> {
    return this.evidence.list(principal, query);
  }

  @Get('usage')
  @Permissions('photo_evidence.read')
  @ApiOkResponse({ type: PhotoEvidenceUsageResponseDto })
  usage(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<PhotoEvidenceUsageResponseDto> {
    return this.evidence.usage(principal);
  }

  @Post()
  @Permissions('photo_evidence.upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { files: 1, fileSize: 26_214_400 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'subjectType', 'subjectId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        subjectType: { type: 'string' },
        subjectId: { type: 'string', format: 'uuid' },
        caption: { type: 'string', maxLength: 1000 },
        capturedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiCreatedResponse({ type: PhotoEvidenceResponseDto })
  upload(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: UploadPhotoEvidenceDto,
    @UploadedFile() file: UploadedPhotoFile | undefined,
    @Req() request: Request & RequestWithContext,
  ): Promise<PhotoEvidenceResponseDto> {
    return this.evidence.upload(
      principal,
      input,
      file,
      requestMetadata(request),
    );
  }

  @Get(':evidenceId/content')
  @Permissions('photo_evidence.read')
  async content(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.evidence.download(principal, evidenceId);
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
}

function requestMetadata(
  request: Request & RequestWithContext,
): RequestMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent'),
    correlationId: request.correlationId,
  };
}

function contentDisposition(fileName: string): string {
  const fallback = fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

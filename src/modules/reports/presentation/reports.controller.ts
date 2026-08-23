import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { Response } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { CurrentUser } from '../../authentication/presentation/current-user.decorator.js';
import { JwtAuthGuard } from '../../authentication/presentation/jwt-auth.guard.js';
import { Permissions } from '../../authorization/presentation/permissions.decorator.js';
import { PermissionsGuard } from '../../authorization/presentation/permissions.guard.js';
import {
  OperationalReportExportDto,
  OperationalReportQueryDto,
} from '../application/dto/report-request.dto.js';
import { OperationalReportResponseDto } from '../application/dto/report-response.dto.js';
import { ReportsService } from '../application/reports.service.js';

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('operational')
  @Permissions('reports.read')
  @ApiOkResponse({ type: OperationalReportResponseDto })
  operational(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: OperationalReportQueryDto,
    @Req() request: Request & RequestWithContext,
  ): Promise<OperationalReportResponseDto> {
    return this.reports.operational(
      principal,
      new Set(request.permissions ?? []),
      query,
    );
  }

  @Post('operational/pdf')
  @Permissions('reports.read', 'reports.export')
  @ApiProduces('application/pdf')
  @ApiCreatedResponse({
    schema: { type: 'string', format: 'binary' },
    description: 'Formal, traceable operational quality report.',
  })
  async exportOperationalPdf(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() input: OperationalReportExportDto,
    @Req() request: Request & RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.reports.exportOperationalPdf(
      principal,
      new Set(request.permissions ?? []),
      input,
      requestMetadata(request),
    );
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', String(file.bytes.length));
    response.setHeader(
      'Content-Disposition',
      contentDisposition(file.fileName),
    );
    response.setHeader('X-Report-Id', file.reportId);
    response.setHeader('X-Content-SHA256', file.pdfSha256);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes);
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

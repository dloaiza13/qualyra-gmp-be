import {
  Controller,
  Get,
  NotFoundException,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Environment } from '../../../common/config/environment.js';
import { MetricsService } from '../application/metrics.service.js';

@Controller('metrics')
@SkipThrottle()
@ApiTags('Operations')
export class MetricsController {
  private readonly enabled: boolean;
  private readonly token: string;

  constructor(
    private readonly metrics: MetricsService,
    config: ConfigService<Environment, true>,
  ) {
    this.enabled = config.getOrThrow('METRICS_ENABLED', { infer: true });
    this.token = config.getOrThrow('METRICS_BEARER_TOKEN', { infer: true });
  }

  @Get()
  @ApiBearerAuth()
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'Prometheus-compatible aggregate operational metrics.',
    schema: { type: 'string' },
  })
  @ApiUnauthorizedResponse({ description: 'Invalid metrics bearer token.' })
  async getMetrics(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    if (!this.enabled) throw new NotFoundException();
    if (!this.hasValidToken(request.headers.authorization)) {
      throw new UnauthorizedException();
    }
    response.type(this.metrics.contentType);
    return this.metrics.render();
  }

  private hasValidToken(authorization: string | undefined): boolean {
    if (!authorization?.startsWith('Bearer ')) return false;
    const received = Buffer.from(authorization.slice('Bearer '.length));
    const expected = Buffer.from(this.token);
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }
}

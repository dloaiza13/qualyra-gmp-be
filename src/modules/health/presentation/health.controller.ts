import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthService,
  type HealthResponse,
  type ReadinessResponse,
} from '../application/health.service.js';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  getLiveness(): HealthResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }
}

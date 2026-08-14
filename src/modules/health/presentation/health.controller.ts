import { Controller, Get } from '@nestjs/common';
import {
  HealthService,
  type HealthResponse,
} from '../application/health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  getLiveness(): HealthResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  getReadiness(): Promise<HealthResponse> {
    return this.healthService.getReadiness();
  }
}

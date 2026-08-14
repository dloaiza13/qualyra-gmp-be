import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';

export interface HealthResponse {
  status: 'up';
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getLiveness(): HealthResponse {
    return this.createHealthyResponse();
  }

  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.createHealthyResponse();
    } catch {
      throw new ServiceUnavailableException({
        status: 'down',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private createHealthyResponse(): HealthResponse {
    return {
      status: 'up',
      timestamp: new Date().toISOString(),
    };
  }
}

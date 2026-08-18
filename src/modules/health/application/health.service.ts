import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { CapaEvidenceScanner } from '../../capas/domain/ports/capa-evidence-scanner.js';
import { CapaEvidenceStorage } from '../../capas/domain/ports/capa-evidence-storage.js';

export interface HealthResponse {
  status: 'up';
  timestamp: string;
}

export interface ReadinessCheck {
  name: 'database' | 'evidenceStorage' | 'malwareScanner';
  status: 'up' | 'down';
  durationMs: number;
}

export interface ReadinessResponse {
  status: 'up' | 'down';
  timestamp: string;
  checks: ReadinessCheck[];
}

@Injectable()
export class HealthService {
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly evidenceStorage: CapaEvidenceStorage,
    private readonly evidenceScanner: CapaEvidenceScanner,
    config: ConfigService<Environment, true>,
  ) {
    this.timeoutMs = config.getOrThrow('OPERATIONAL_READINESS_TIMEOUT_MS', {
      infer: true,
    });
  }

  getLiveness(): HealthResponse {
    return this.createHealthyResponse();
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const checks = await Promise.all([
      this.runCheck('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.runCheck('evidenceStorage', () =>
        this.evidenceStorage.checkHealth(),
      ),
      this.runCheck('malwareScanner', () => this.evidenceScanner.checkHealth()),
    ]);
    const response: ReadinessResponse = {
      status: checks.every(({ status }) => status === 'up') ? 'up' : 'down',
      timestamp: new Date().toISOString(),
      checks,
    };
    if (response.status === 'down') {
      throw new ServiceUnavailableException({
        ...response,
      });
    }
    return response;
  }

  private createHealthyResponse(): HealthResponse {
    return {
      status: 'up',
      timestamp: new Date().toISOString(),
    };
  }

  private async runCheck(
    name: ReadinessCheck['name'],
    operation: () => Promise<unknown>,
  ): Promise<ReadinessCheck> {
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Readiness check timed out.')),
            this.timeoutMs,
          );
          timer.unref();
        }),
      ]);
      return {
        name,
        status: 'up',
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    } catch {
      return {
        name,
        status: 'down',
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { CapaEvidenceStorage } from '../domain/ports/capa-evidence-storage.js';

@Injectable()
export class CapaEvidenceRetentionService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CapaEvidenceRetentionService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly storage: CapaEvidenceStorage,
    config: ConfigService<Environment, true>,
  ) {
    this.enabled =
      config.getOrThrow('CAPA_EVIDENCE_RETENTION_ENABLED', { infer: true }) &&
      config.getOrThrow('NODE_ENV', { infer: true }) !== 'test';
    this.intervalMs =
      config.getOrThrow('CAPA_EVIDENCE_RETENTION_INTERVAL_MINUTES', {
        infer: true,
      }) * 60_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.startRecurringRun(), 5_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async runTenant(tenantId: string, now = new Date()): Promise<number> {
    const candidates = await this.tenantUnitOfWork.execute(
      tenantId,
      (transaction) =>
        transaction.capaEvidenceUpload.findMany({
          where: {
            tenantId,
            consumedAt: null,
            OR: [
              { scanStatus: 'PURGING' },
              { scanStatus: 'AVAILABLE', expiresAt: { lte: now } },
            ],
          },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          take: 100,
          select: { id: true, objectKey: true, scanStatus: true },
        }),
    );

    let purged = 0;
    for (const candidate of candidates) {
      if (candidate.scanStatus === 'AVAILABLE') {
        const claimed = await this.tenantUnitOfWork.execute(
          tenantId,
          (transaction) =>
            transaction.capaEvidenceUpload.updateMany({
              where: {
                id: candidate.id,
                tenantId,
                scanStatus: 'AVAILABLE',
                consumedAt: null,
                expiresAt: { lte: now },
              },
              data: { scanStatus: 'PURGING' },
            }),
        );
        if (claimed.count !== 1) continue;
      }

      try {
        await this.storage.remove(candidate.objectKey);
        const finalized = await this.tenantUnitOfWork.execute(
          tenantId,
          (transaction) =>
            transaction.capaEvidenceUpload.updateMany({
              where: {
                id: candidate.id,
                tenantId,
                scanStatus: 'PURGING',
                consumedAt: null,
              },
              data: { scanStatus: 'EXPIRED', purgedAt: now },
            }),
        );
        purged += finalized.count;
      } catch (error: unknown) {
        this.logger.error(
          {
            tenantId,
            evidenceUploadId: candidate.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Managed CAPA evidence purge failed and will be retried',
        );
      }
    }
    return purged;
  }

  private async startRecurringRun(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      for (const { id } of tenants) {
        await this.runTenant(id).catch((error: unknown) =>
          this.logger.error(
            {
              tenantId: id,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'CAPA evidence retention failed for tenant',
          ),
        );
      }
    } finally {
      this.running = false;
      if (this.enabled) {
        this.timer = setTimeout(
          () => void this.startRecurringRun(),
          this.intervalMs,
        );
        this.timer.unref();
      }
    }
  }
}

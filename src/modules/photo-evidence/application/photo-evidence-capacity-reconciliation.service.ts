import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { Environment } from '../../../common/config/environment.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { MetricsService } from '../../observability/application/metrics.service.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import {
  type PhotoEvidenceCapacityStatus,
  PhotoEvidenceCapacityPolicy,
} from './photo-evidence-capacity.policy.js';

export interface PhotoEvidenceReconciliationResult {
  tenantsChecked: number;
  tenantsFailed: number;
  mismatches: number;
  capacity: Record<PhotoEvidenceCapacityStatus, number>;
}

@Injectable()
export class PhotoEvidenceCapacityReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    PhotoEvidenceCapacityReconciliationService.name,
  );
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly capacityPolicy: PhotoEvidenceCapacityPolicy,
    private readonly metrics: MetricsService,
    config: ConfigService<Environment, true>,
  ) {
    this.enabled =
      config.getOrThrow('PHOTO_EVIDENCE_RECONCILIATION_ENABLED', {
        infer: true,
      }) && config.getOrThrow('NODE_ENV', { infer: true }) !== 'test';
    this.intervalMs =
      config.getOrThrow('PHOTO_EVIDENCE_RECONCILIATION_INTERVAL_MINUTES', {
        infer: true,
      }) * 60_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.startRecurringRun(), 7_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async run(): Promise<PhotoEvidenceReconciliationResult> {
    const startedAt = performance.now();
    const capacity = emptyCapacityCounts();
    let tenantsChecked = 0;
    let tenantsFailed = 0;
    let mismatches = 0;
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    for (const batch of batchesOf(tenants, 5)) {
      const results = await Promise.allSettled(
        batch.map(({ id }) => this.reconcileTenant(id)),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          tenantsFailed += 1;
          this.logger.error(
            {
              tenantId: batch[index]?.id,
              error: errorMessage(result.reason),
            },
            'Photographic evidence capacity reconciliation failed for tenant',
          );
          return;
        }
        tenantsChecked += 1;
        capacity[result.value.capacityStatus] += 1;
        if (result.value.mismatch) {
          mismatches += 1;
          this.logger.error(
            {
              tenantId: batch[index]?.id,
              actualBytes: result.value.actualBytes.toString(),
              counterBytes: result.value.counterBytes.toString(),
              actualCount: result.value.actualCount,
              counterCount: result.value.counterCount,
            },
            'Photographic evidence usage counter mismatch detected',
          );
        }
      });
    }

    const result = { tenantsChecked, tenantsFailed, mismatches, capacity };
    this.metrics.updatePhotoEvidenceCapacity(result);
    this.metrics.recordPhotoEvidenceReconciliation(
      tenantsFailed === 0 ? 'success' : 'partial',
      (performance.now() - startedAt) / 1_000,
    );
    return result;
  }

  private async startRecurringRun(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error: unknown) {
      this.metrics.recordPhotoEvidenceReconciliation('failure', 0);
      this.logger.error(
        { error: errorMessage(error) },
        'Photographic evidence capacity reconciliation failed',
      );
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

  private reconcileTenant(tenantId: string): Promise<{
    mismatch: boolean;
    actualBytes: bigint;
    counterBytes: bigint;
    actualCount: number;
    counterCount: number;
    capacityStatus: PhotoEvidenceCapacityStatus;
  }> {
    return this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      await lockTenantUsage(transaction, tenantId);
      const [tenant, actual, existingCounter] = await Promise.all([
        transaction.tenant.findFirstOrThrow({
          where: { id: tenantId },
          select: { plan: true },
        }),
        transaction.photoEvidence.aggregate({
          where: { tenantId },
          _sum: { sizeBytes: true },
          _count: { _all: true },
        }),
        transaction.tenantPhotoEvidenceUsage.findUnique({
          where: { tenantId },
          select: { usedBytes: true, photoCount: true },
        }),
      ]);
      const actualBytes = BigInt(actual._sum.sizeBytes ?? 0);
      const actualCount = actual._count._all;
      const counter =
        existingCounter ??
        (await transaction.tenantPhotoEvidenceUsage.create({
          data: { tenantId, usedBytes: actualBytes, photoCount: actualCount },
          select: { usedBytes: true, photoCount: true },
        }));
      const quotaBytes = this.capacityPolicy.quotaFor(tenant.plan);
      return {
        mismatch:
          counter.usedBytes !== actualBytes ||
          counter.photoCount !== actualCount,
        actualBytes,
        counterBytes: counter.usedBytes,
        actualCount,
        counterCount: counter.photoCount,
        capacityStatus: this.capacityPolicy.statusFor(
          Number(counter.usedBytes),
          quotaBytes,
        ),
      };
    });
  }
}

function emptyCapacityCounts(): Record<PhotoEvidenceCapacityStatus, number> {
  return { NORMAL: 0, WARNING: 0, CRITICAL: 0, OVER_QUOTA: 0 };
}

function batchesOf<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

async function lockTenantUsage(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await transaction.$queryRaw`
    SELECT 1::int AS locked
    FROM pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:photo-evidence`}, 0)
    )
  `;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

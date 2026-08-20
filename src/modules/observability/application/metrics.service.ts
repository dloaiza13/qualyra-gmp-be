import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';

const outboxStatuses = [
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'DEAD_LETTER',
] as const;

type DeliveryOutcome = 'processed' | 'retry_scheduled' | 'dead_letter';
type PhotoEvidenceOutcome =
  'success' | 'rejected' | 'quota_exceeded' | 'storage_error';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpRequests = new Counter({
    name: 'qualyra_http_requests_total',
    help: 'Completed HTTP requests.',
    labelNames: ['method', 'route', 'status_code'] as const,
    registers: [this.registry],
  });
  private readonly httpDuration = new Histogram({
    name: 'qualyra_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });
  private readonly outboxMessages = new Gauge({
    name: 'qualyra_outbox_messages',
    help: 'Current notification outbox messages by status, aggregated across tenants.',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });
  private readonly outboxDeliveries = new Counter({
    name: 'qualyra_outbox_delivery_attempts_total',
    help: 'Notification delivery attempt outcomes.',
    labelNames: ['type', 'outcome'] as const,
    registers: [this.registry],
  });
  private readonly outboxDeliveryDuration = new Histogram({
    name: 'qualyra_outbox_delivery_duration_seconds',
    help: 'Notification delivery attempt duration in seconds.',
    labelNames: ['type'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });
  private readonly outboxLeaseRecoveries = new Counter({
    name: 'qualyra_outbox_lease_recoveries_total',
    help: 'Expired notification leases recovered by outcome.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  private readonly outboxWorkerRuns = new Counter({
    name: 'qualyra_outbox_worker_runs_total',
    help: 'Notification worker runs by outcome.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  private readonly outboxWorkerLastSuccess = new Gauge({
    name: 'qualyra_outbox_worker_last_success_timestamp_seconds',
    help: 'Unix timestamp of the most recent successful notification worker run.',
    registers: [this.registry],
  });
  private readonly dependencyReady = new Gauge({
    name: 'qualyra_dependency_ready',
    help: 'Whether an operational dependency responded during metric collection.',
    labelNames: ['dependency'] as const,
    registers: [this.registry],
  });
  private readonly collectionSuccess = new Gauge({
    name: 'qualyra_metrics_collection_success',
    help: 'Whether collection of a dynamic metric source succeeded.',
    labelNames: ['source'] as const,
    registers: [this.registry],
  });
  private readonly photoEvidenceUploads = new Counter({
    name: 'qualyra_photo_evidence_uploads_total',
    help: 'Controlled photographic evidence upload outcomes.',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });
  private readonly photoEvidenceBytes = new Counter({
    name: 'qualyra_photo_evidence_uploaded_bytes_total',
    help: 'Bytes accepted as controlled photographic evidence.',
    registers: [this.registry],
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly redis: RedisService,
  ) {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'qualyra_node_',
    });
  }

  recordHttpRequest(input: {
    method: string;
    route: string;
    statusCode: number;
    durationSeconds: number;
  }): void {
    const labels = {
      method: input.method,
      route: input.route,
      status_code: String(input.statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, input.durationSeconds);
  }

  recordOutboxDelivery(
    type: string,
    outcome: DeliveryOutcome,
    durationSeconds: number,
  ): void {
    this.outboxDeliveries.inc({ type, outcome });
    this.outboxDeliveryDuration.observe({ type }, durationSeconds);
  }

  recordOutboxLeaseRecovery(
    outcome: 'retry' | 'dead_letter',
    count: number,
  ): void {
    if (count > 0) this.outboxLeaseRecoveries.inc({ outcome }, count);
  }

  recordOutboxWorkerRun(success: boolean): void {
    this.outboxWorkerRuns.inc({ outcome: success ? 'success' : 'failure' });
    if (success) this.outboxWorkerLastSuccess.set(Date.now() / 1_000);
  }

  recordPhotoEvidenceUpload(
    outcome: PhotoEvidenceOutcome,
    acceptedBytes = 0,
  ): void {
    this.photoEvidenceUploads.inc({ outcome });
    if (outcome === 'success' && acceptedBytes > 0) {
      this.photoEvidenceBytes.inc(acceptedBytes);
    }
  }

  async render(): Promise<string> {
    await Promise.all([this.refreshOutboxCounts(), this.refreshRedisStatus()]);
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  private async refreshOutboxCounts(): Promise<void> {
    try {
      const totals = new Map<string, number>(
        outboxStatuses.map((status) => [status, 0]),
      );
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      for (const tenant of tenants) {
        const groups = await this.tenantUnitOfWork.execute(
          tenant.id,
          (transaction) =>
            transaction.outboxMessage.groupBy({
              by: ['status'],
              _count: { _all: true },
            }),
        );
        for (const group of groups) {
          totals.set(
            group.status,
            (totals.get(group.status) ?? 0) + group._count._all,
          );
        }
      }
      for (const status of outboxStatuses) {
        this.outboxMessages.set({ status }, totals.get(status) ?? 0);
      }
      this.collectionSuccess.set({ source: 'outbox' }, 1);
    } catch {
      this.collectionSuccess.set({ source: 'outbox' }, 0);
    }
  }

  private async refreshRedisStatus(): Promise<void> {
    try {
      await this.redis.ping();
      this.dependencyReady.set({ dependency: 'redis' }, 1);
      this.collectionSuccess.set({ source: 'redis' }, 1);
    } catch {
      this.dependencyReady.set({ dependency: 'redis' }, 0);
      this.collectionSuccess.set({ source: 'redis' }, 0);
    }
  }
}

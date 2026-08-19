import {
  HttpStatus,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type {
  OutboxMessage,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { AuthenticationNotifier } from '../../authentication/domain/ports/authentication-notifier.js';
import { CapaMonitoringNotifier } from '../../capas/domain/ports/capa-monitoring-notifier.js';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import { appendSecurityEvent } from '../../security-events/application/append-security-event.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  NotificationDeliveryQueryDto,
  NotificationDeliveryResponseDto,
} from './dto/notification-delivery.dto.js';
import { OutboxPayloadCipher } from './outbox-payload-cipher.js';

export const notificationTypes = {
  emailVerification: 'AUTH_EMAIL_VERIFICATION',
  passwordReset: 'AUTH_PASSWORD_RESET',
  invitation: 'AUTH_INVITATION',
  capaMonitoring: 'CAPA_MONITORING',
} as const;

type NotificationType =
  (typeof notificationTypes)[keyof typeof notificationTypes];

const authenticationPayloadSchema = z.object({
  email: z.email(),
  displayName: z.string().min(1),
  tenantSlug: z.string().min(1),
  token: z.string().min(1),
});
const invitationPayloadSchema = authenticationPayloadSchema.extend({
  tenantName: z.string().min(1),
  roles: z.array(z.string().min(1)),
});
const capaPayloadSchema = z.object({ capaNotificationId: z.uuid() });

export interface EnqueueNotificationInput {
  tenantId: string;
  type: NotificationType;
  deduplicationKey: string;
  payload: unknown;
}

@Injectable()
export class NotificationOutboxService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationOutboxService.name);
  private readonly workerId = randomUUID();
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly lockTimeoutMs: number;
  private readonly retryBaseSeconds: number;
  private readonly retryMaxSeconds: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly cipher: OutboxPayloadCipher,
    private readonly authenticationNotifier: AuthenticationNotifier,
    private readonly capaNotifier: CapaMonitoringNotifier,
    config: ConfigService<Environment, true>,
  ) {
    this.enabled =
      config.getOrThrow('OUTBOX_WORKER_ENABLED', { infer: true }) &&
      config.getOrThrow('NODE_ENV', { infer: true }) !== 'test';
    this.pollIntervalMs = config.getOrThrow('OUTBOX_POLL_INTERVAL_MS', {
      infer: true,
    });
    this.batchSize = config.getOrThrow('OUTBOX_BATCH_SIZE', { infer: true });
    this.maxAttempts = config.getOrThrow('OUTBOX_MAX_ATTEMPTS', {
      infer: true,
    });
    this.lockTimeoutMs =
      config.getOrThrow('OUTBOX_LOCK_TIMEOUT_MINUTES', { infer: true }) *
      60_000;
    this.retryBaseSeconds = config.getOrThrow('OUTBOX_RETRY_BASE_SECONDS', {
      infer: true,
    });
    this.retryMaxSeconds = config.getOrThrow('OUTBOX_RETRY_MAX_SECONDS', {
      infer: true,
    });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.startRecurringRun(), 2_500);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async enqueue(
    transaction: Prisma.TransactionClient,
    input: EnqueueNotificationInput,
  ): Promise<void> {
    const context = payloadContext(input);
    await transaction.outboxMessage.createMany({
      data: [
        {
          tenantId: input.tenantId,
          type: input.type,
          deduplicationKey: input.deduplicationKey,
          payload: this.cipher.encrypt(input.payload, context),
        },
      ],
      skipDuplicates: true,
    });
  }

  async cancelPending(
    transaction: Prisma.TransactionClient,
    input: {
      tenantId: string;
      type: NotificationType;
      deduplicationKeyPrefix: string;
    },
  ): Promise<void> {
    await transaction.outboxMessage.updateMany({
      where: {
        tenantId: input.tenantId,
        type: input.type,
        deduplicationKey: { startsWith: input.deduplicationKeyPrefix },
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        lastError: null,
        payload: { version: 1, purged: true },
      },
    });
  }

  async deliverTenant(tenantId: string, now = new Date()): Promise<void> {
    const claimed = await this.claimTenant(tenantId, now);
    for (const message of claimed) {
      let capaNotificationId: string | undefined;
      try {
        const payload = this.decrypt(message);
        capaNotificationId = await this.dispatch(message, payload);
        await this.markProcessed(message, capaNotificationId);
      } catch (error: unknown) {
        await this.markFailed(message, error, capaNotificationId);
      }
    }
  }

  list(
    principal: AuthenticatedPrincipal,
    query: NotificationDeliveryQueryDto,
  ): Promise<NotificationDeliveryResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const deliveries = await transaction.outboxMessage.findMany({
          where: { tenantId: principal.tenantId, status: query.status },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
        });
        return deliveries.map(mapDelivery);
      },
    );
  }

  retry(
    principal: AuthenticatedPrincipal,
    deliveryId: string,
    request: RequestMetadata,
  ): Promise<NotificationDeliveryResponseDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const delivery = await transaction.outboxMessage.findFirst({
          where: { id: deliveryId, tenantId: principal.tenantId },
        });
        if (!delivery || delivery.status !== 'DEAD_LETTER') {
          throw new ApplicationError(
            ErrorCode.NotificationDeliveryInvalid,
            'The notification delivery cannot be retried.',
            HttpStatus.CONFLICT,
          );
        }
        const retried = await transaction.outboxMessage.update({
          where: { id: delivery.id },
          data: {
            status: 'PENDING',
            attempts: 0,
            manualRetries: { increment: 1 },
            availableAt: new Date(),
            deadLetteredAt: null,
            lastError: null,
          },
        });
        await appendSecurityEvent(transaction, {
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          eventType: 'NOTIFICATION_DELIVERY_RETRIED',
          outcome: 'SUCCESS',
          request,
          metadata: { deliveryId: delivery.id, type: delivery.type },
        });
        return mapDelivery(retried);
      },
    );
  }

  private async startRecurringRun(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
      for (const tenant of tenants) {
        await this.deliverTenant(tenant.id).catch((error: unknown) =>
          this.logger.error(
            { tenantId: tenant.id, error: deliveryErrorCode(error) },
            'Notification outbox tenant run failed',
          ),
        );
      }
    } finally {
      this.running = false;
      if (this.enabled) {
        this.timer = setTimeout(
          () => void this.startRecurringRun(),
          this.pollIntervalMs,
        );
        this.timer.unref();
      }
    }
  }

  private claimTenant(tenantId: string, now: Date): Promise<OutboxMessage[]> {
    return this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      const staleBefore = new Date(now.getTime() - this.lockTimeoutMs);
      await transaction.outboxMessage.updateMany({
        where: {
          tenantId,
          status: 'PROCESSING',
          lockedAt: { lt: staleBefore },
          attempts: { gte: this.maxAttempts },
        },
        data: {
          status: 'DEAD_LETTER',
          lockedAt: null,
          lockedBy: null,
          deadLetteredAt: now,
          lastError: 'DELIVERY_LEASE_EXPIRED',
        },
      });
      await transaction.outboxMessage.updateMany({
        where: {
          tenantId,
          status: 'PROCESSING',
          lockedAt: { lt: staleBefore },
          attempts: { lt: this.maxAttempts },
        },
        data: {
          status: 'FAILED',
          lockedAt: null,
          lockedBy: null,
          availableAt: now,
          lastError: 'DELIVERY_LEASE_EXPIRED',
        },
      });

      const candidates = await transaction.outboxMessage.findMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'FAILED'] },
          attempts: { lt: this.maxAttempts },
          availableAt: { lte: now },
        },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
        take: this.batchSize,
      });
      const claimed: OutboxMessage[] = [];
      for (const candidate of candidates) {
        const result = await transaction.outboxMessage.updateMany({
          where: {
            id: candidate.id,
            tenantId,
            status: candidate.status,
            attempts: candidate.attempts,
            availableAt: { lte: now },
          },
          data: {
            status: 'PROCESSING',
            attempts: { increment: 1 },
            lockedAt: now,
            lockedBy: this.workerId,
            lastAttemptAt: now,
            lastError: null,
          },
        });
        if (result.count === 1) {
          claimed.push({
            ...candidate,
            status: 'PROCESSING',
            attempts: candidate.attempts + 1,
            lockedAt: now,
            lockedBy: this.workerId,
            lastAttemptAt: now,
            lastError: null,
          });
        }
      }
      return claimed;
    });
  }

  private decrypt(message: OutboxMessage): unknown {
    return this.cipher.decrypt(
      message.payload,
      payloadContext({
        tenantId: message.tenantId,
        type: message.type,
        deduplicationKey: message.deduplicationKey,
      }),
    );
  }

  private async dispatch(
    message: OutboxMessage,
    rawPayload: unknown,
  ): Promise<string | undefined> {
    if (message.type === notificationTypes.emailVerification) {
      const payload = authenticationPayloadSchema.parse(rawPayload);
      await this.authenticationNotifier.sendEmailVerification({
        ...payload,
        deliveryId: message.id,
      });
      return undefined;
    }
    if (message.type === notificationTypes.passwordReset) {
      const payload = authenticationPayloadSchema.parse(rawPayload);
      await this.authenticationNotifier.sendPasswordReset({
        ...payload,
        deliveryId: message.id,
      });
      return undefined;
    }
    if (message.type === notificationTypes.invitation) {
      const payload = invitationPayloadSchema.parse(rawPayload);
      await this.authenticationNotifier.sendInvitation({
        ...payload,
        deliveryId: message.id,
      });
      return undefined;
    }
    if (message.type === notificationTypes.capaMonitoring) {
      const payload = capaPayloadSchema.parse(rawPayload);
      const notification = await this.loadCapaNotification(
        message.tenantId,
        payload.capaNotificationId,
      );
      await this.capaNotifier.send({
        email: notification.recipientUser.email,
        displayName: notification.recipientUser.displayName,
        tenantName: notification.tenant.name,
        capaId: notification.capaId,
        capaCode: notification.capa.code,
        capaTitle: notification.capa.title,
        subjectType: notification.subjectType,
        subjectTitle:
          notification.action?.title ??
          notification.effectivenessReview?.criterion ??
          notification.capa.title,
        dueState: notification.dueState,
        dueAt: notification.dueAt,
        deliveryId: message.id,
      });
      return notification.id;
    }
    throw new Error('UNSUPPORTED_NOTIFICATION_TYPE');
  }

  private loadCapaNotification(tenantId: string, notificationId: string) {
    return this.tenantUnitOfWork.execute(tenantId, (transaction) =>
      transaction.capaNotification.findFirstOrThrow({
        where: { id: notificationId, tenantId },
        include: {
          tenant: { select: { name: true } },
          capa: { select: { code: true, title: true } },
          recipientUser: { select: { email: true, displayName: true } },
          action: { select: { title: true } },
          effectivenessReview: { select: { criterion: true } },
        },
      }),
    );
  }

  private markProcessed(
    message: OutboxMessage,
    capaNotificationId?: string,
  ): Promise<void> {
    return this.tenantUnitOfWork.execute(
      message.tenantId,
      async (transaction) => {
        const now = new Date();
        await transaction.outboxMessage.updateMany({
          where: {
            id: message.id,
            tenantId: message.tenantId,
            status: 'PROCESSING',
            lockedBy: this.workerId,
          },
          data: {
            status: 'PROCESSED',
            processedAt: now,
            lockedAt: null,
            lockedBy: null,
            lastError: null,
            payload: { version: 1, purged: true },
          },
        });
        if (capaNotificationId) {
          await transaction.capaNotification.updateMany({
            where: { id: capaNotificationId, tenantId: message.tenantId },
            data: {
              status: 'DELIVERED',
              attempts: message.attempts,
              deliveredAt: now,
              lastError: null,
            },
          });
        }
      },
    );
  }

  private markFailed(
    message: OutboxMessage,
    error: unknown,
    capaNotificationId?: string,
  ): Promise<void> {
    const deadLetter = message.attempts >= this.maxAttempts;
    const errorCode = deliveryErrorCode(error);
    const retrySeconds = Math.min(
      this.retryMaxSeconds,
      this.retryBaseSeconds * 2 ** Math.max(0, message.attempts - 1),
    );
    return this.tenantUnitOfWork.execute(
      message.tenantId,
      async (transaction) => {
        await transaction.outboxMessage.updateMany({
          where: {
            id: message.id,
            tenantId: message.tenantId,
            status: 'PROCESSING',
            lockedBy: this.workerId,
          },
          data: {
            status: deadLetter ? 'DEAD_LETTER' : 'FAILED',
            availableAt: new Date(Date.now() + retrySeconds * 1_000),
            lockedAt: null,
            lockedBy: null,
            deadLetteredAt: deadLetter ? new Date() : null,
            lastError: errorCode,
          },
        });
        if (capaNotificationId) {
          await transaction.capaNotification.updateMany({
            where: { id: capaNotificationId, tenantId: message.tenantId },
            data: {
              status: 'FAILED',
              attempts: message.attempts,
              lastError: errorCode,
            },
          });
        }
        this.logger.warn(
          {
            tenantId: message.tenantId,
            deliveryId: message.id,
            type: message.type,
            attempt: message.attempts,
            error: errorCode,
          },
          deadLetter
            ? 'Notification moved to dead letter'
            : 'Notification delivery scheduled for retry',
        );
      },
    );
  }
}

function payloadContext(input: {
  tenantId: string;
  type: string;
  deduplicationKey: string;
}): string {
  return `${input.tenantId}:${input.type}:${input.deduplicationKey}`;
}

function deliveryErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code).toUpperCase();
    if (/^[A-Z0-9_]{2,100}$/.test(code)) return code;
  }
  if (error instanceof z.ZodError) return 'INVALID_ENCRYPTED_PAYLOAD';
  if (
    error instanceof Error &&
    error.message === 'UNSUPPORTED_NOTIFICATION_TYPE'
  ) {
    return error.message;
  }
  return 'DELIVERY_FAILED';
}

function mapDelivery(delivery: OutboxMessage): NotificationDeliveryResponseDto {
  return {
    id: delivery.id,
    type: delivery.type,
    status: delivery.status,
    attempts: delivery.attempts,
    manualRetries: delivery.manualRetries,
    availableAt: delivery.availableAt.toISOString(),
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    processedAt: delivery.processedAt?.toISOString() ?? null,
    deadLetteredAt: delivery.deadLetteredAt?.toISOString() ?? null,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt.toISOString(),
  };
}

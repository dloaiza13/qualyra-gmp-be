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
import { NotificationOutboxService } from '../../notifications/application/notification-outbox.service.js';

const dayMs = 24 * 60 * 60 * 1000;

@Injectable()
export class CapaMonitoringService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CapaMonitoringService.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly outbox: NotificationOutboxService,
    config: ConfigService<Environment, true>,
  ) {
    this.enabled =
      config.getOrThrow('CAPA_MONITORING_ENABLED', { infer: true }) &&
      config.getOrThrow('NODE_ENV', { infer: true }) !== 'test';
    this.intervalMs =
      config.getOrThrow('CAPA_MONITORING_INTERVAL_MINUTES', { infer: true }) *
      60_000;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setTimeout(() => void this.startRecurringRun(), 2_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async runTenant(tenantId: string, now = new Date()): Promise<void> {
    await this.enqueueTenant(tenantId, now);
    await this.outbox.deliverTenant(tenantId, now);
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
            { tenantId: id, error: errorMessage(error) },
            'CAPA monitoring failed for tenant',
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

  private enqueueTenant(tenantId: string, now: Date): Promise<void> {
    return this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      const [actions, reviews, escalationRecipients] = await Promise.all([
        transaction.capaAction.findMany({
          where: {
            tenantId,
            status: 'OPEN',
            assignedToUser: { status: 'ACTIVE' },
          },
          include: {
            capa: { select: { id: true, code: true, title: true } },
            assignedToUser: {
              select: { id: true, email: true, displayName: true },
            },
            extensions: {
              orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { newDueAt: true },
            },
          },
        }),
        transaction.capaEffectivenessReview.findMany({
          where: {
            tenantId,
            status: 'SCHEDULED',
            assignedToUser: { status: 'ACTIVE' },
          },
          include: {
            capa: { select: { id: true, code: true, title: true } },
            assignedToUser: {
              select: { id: true, email: true, displayName: true },
            },
          },
        }),
        transaction.user.findMany({
          where: {
            tenantId,
            status: 'ACTIVE',
            userRoles: {
              some: {
                role: {
                  rolePermissions: {
                    some: {
                      permission: {
                        code: {
                          in: [
                            'capas.approve_extensions',
                            'capas.schedule_effectiveness',
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          select: { id: true },
        }),
      ]);

      const escalationIds = escalationRecipients.map(({ id }) => id);
      const notifications: {
        tenantId: string;
        capaId: string;
        actionId?: string;
        effectivenessReviewId?: string;
        recipientUserId: string;
        subjectType: 'ACTION' | 'EFFECTIVENESS_REVIEW';
        dueState: 'DUE_SOON' | 'OVERDUE' | 'ESCALATED';
        dueAt: Date;
        deduplicationKey: string;
      }[] = [];

      for (const action of actions) {
        const dueAt = action.extensions[0]?.newDueAt ?? action.dueAt;
        const dueState = monitoringDueState(dueAt, now);
        if (!dueState) continue;
        const recipients = new Set([
          action.assignedToUserId,
          ...(dueState === 'ESCALATED' ? escalationIds : []),
        ]);
        for (const recipientUserId of recipients) {
          notifications.push({
            tenantId,
            capaId: action.capaId,
            actionId: action.id,
            recipientUserId,
            subjectType: 'ACTION',
            dueState,
            dueAt,
            deduplicationKey: notificationKey(
              'action',
              action.id,
              recipientUserId,
              dueState,
              dueAt,
            ),
          });
        }
      }

      for (const review of reviews) {
        const dueState = monitoringDueState(review.dueAt, now);
        if (!dueState) continue;
        const recipients = new Set([
          review.assignedToUserId,
          ...(dueState === 'ESCALATED' ? escalationIds : []),
        ]);
        for (const recipientUserId of recipients) {
          notifications.push({
            tenantId,
            capaId: review.capaId,
            effectivenessReviewId: review.id,
            recipientUserId,
            subjectType: 'EFFECTIVENESS_REVIEW',
            dueState,
            dueAt: review.dueAt,
            deduplicationKey: notificationKey(
              'review',
              review.id,
              recipientUserId,
              dueState,
              review.dueAt,
            ),
          });
        }
      }

      if (notifications.length > 0) {
        await transaction.capaNotification.createMany({
          data: notifications,
          skipDuplicates: true,
        });
        const queuedNotifications = await transaction.capaNotification.findMany(
          {
            where: {
              tenantId,
              deduplicationKey: {
                in: notifications.map(
                  ({ deduplicationKey }) => deduplicationKey,
                ),
              },
              status: { in: ['PENDING', 'FAILED', 'PROCESSING'] },
            },
            select: { id: true },
          },
        );
        for (const notification of queuedNotifications) {
          await this.outbox.enqueue(transaction, {
            tenantId,
            type: 'CAPA_MONITORING',
            deduplicationKey: `capa-notification:${notification.id}`,
            payload: { capaNotificationId: notification.id },
          });
        }
      }
    });
  }
}

function monitoringDueState(
  dueAt: Date,
  now: Date,
): 'DUE_SOON' | 'OVERDUE' | 'ESCALATED' | null {
  if (dueAt.getTime() < now.getTime() - 7 * dayMs) return 'ESCALATED';
  if (dueAt.getTime() < now.getTime()) return 'OVERDUE';
  if (dueAt.getTime() <= now.getTime() + 7 * dayMs) return 'DUE_SOON';
  return null;
}

function notificationKey(
  subject: string,
  subjectId: string,
  recipientId: string,
  state: string,
  dueAt: Date,
): string {
  return [subject, subjectId, recipientId, state, dueAt.toISOString()].join(
    ':',
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unknown notification delivery failure.';
}

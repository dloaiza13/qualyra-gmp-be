import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import { CapaMonitoringNotifier } from '../domain/ports/capa-monitoring-notifier.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';

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
    private readonly notifier: CapaMonitoringNotifier,
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
    await this.deliverTenant(tenantId, now);
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
      }
    });
  }

  private deliverTenant(tenantId: string, now: Date): Promise<void> {
    return this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      await transaction.capaNotification.updateMany({
        where: {
          tenantId,
          status: 'PROCESSING',
          updatedAt: { lt: new Date(now.getTime() - 30 * 60_000) },
          attempts: { lt: 10 },
        },
        data: {
          status: 'FAILED',
          lastError: 'Delivery lease expired before confirmation.',
        },
      });

      const pending = await transaction.capaNotification.findMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'FAILED'] },
          attempts: { lt: 10 },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: {
          tenant: { select: { name: true } },
          capa: { select: { code: true, title: true } },
          recipientUser: {
            select: { email: true, displayName: true },
          },
          action: { select: { title: true } },
          effectivenessReview: { select: { criterion: true } },
        },
      });

      for (const notification of pending) {
        const claimed = await transaction.capaNotification.updateMany({
          where: {
            id: notification.id,
            tenantId,
            status: notification.status,
            attempts: notification.attempts,
          },
          data: {
            status: 'PROCESSING',
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        if (claimed.count !== 1) continue;

        try {
          await this.notifier.send({
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
          });
          await transaction.capaNotification.update({
            where: { id: notification.id },
            data: {
              status: 'DELIVERED',
              deliveredAt: new Date(),
              lastError: null,
            },
          });
        } catch (error: unknown) {
          await transaction.capaNotification.update({
            where: { id: notification.id },
            data: {
              status: 'FAILED',
              lastError: errorMessage(error).slice(0, 1000),
            },
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

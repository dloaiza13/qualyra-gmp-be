import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Prisma,
  TenantPlan,
  TenantStatus,
  UserStatus,
} from '../../../generated/prisma/client.js';
import type { Environment } from '../../../common/config/environment.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';
import { PhotoEvidenceCapacityPolicy } from '../../photo-evidence/application/photo-evidence-capacity.policy.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  PlatformAuditEventQueryDto,
  PlatformTenantQueryDto,
  UpdatePlatformTenantDto,
} from './dto/platform-tenant-request.dto.js';
import type {
  PlatformAuditEventPageResponseDto,
  PlatformTenantPageResponseDto,
  PlatformTenantResponseDto,
} from './dto/platform-tenant-response.dto.js';

type TenantSnapshot = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: TenantPlan;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PlatformTenantsService {
  private readonly operatorId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly capacityPolicy: PhotoEvidenceCapacityPolicy,
    config: ConfigService<Environment, true>,
  ) {
    this.operatorId = config.getOrThrow('PLATFORM_OPERATOR_ID', {
      infer: true,
    });
  }

  async list(
    query: PlatformTenantQueryDto,
  ): Promise<PlatformTenantPageResponseDto> {
    let cursorPosition: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorPosition = await this.prisma.tenant.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, id: true },
      });
      if (!cursorPosition) throw invalidTenant('The tenant cursor is invalid.');
    }
    const search = query.search?.trim();
    const conditions: Prisma.TenantWhereInput[] = [];
    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (cursorPosition) {
      conditions.push({
        OR: [
          { createdAt: { lt: cursorPosition.createdAt } },
          {
            createdAt: cursorPosition.createdAt,
            id: { lt: cursorPosition.id },
          },
        ],
      });
    }
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: query.status,
        plan: query.plan,
        AND: conditions,
      },
      select: tenantSelection,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = tenants.length > query.limit;
    const page = hasMore ? tenants.slice(0, query.limit) : tenants;
    const items: PlatformTenantResponseDto[] = [];
    for (const batch of batchesOf(page, 5)) {
      items.push(
        ...(await Promise.all(batch.map((tenant) => this.enrich(tenant)))),
      );
    }
    return {
      items,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async get(tenantId: string): Promise<PlatformTenantResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: tenantSelection,
    });
    if (!tenant) throw tenantNotFound();
    return this.enrich(tenant);
  }

  async update(
    tenantId: string,
    input: UpdatePlatformTenantDto,
    request: RequestMetadata,
  ): Promise<PlatformTenantResponseDto> {
    const reason = input.reason.trim();
    if (reason.length < 10) {
      throw invalidTenant('A meaningful commercial change reason is required.');
    }
    await this.tenantUnitOfWork.execute(tenantId, async (transaction) => {
      const locked = await transaction.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM tenants
        WHERE id = ${tenantId}::uuid
        FOR UPDATE
      `;
      if (locked.length !== 1) throw tenantNotFound();
      const current = await transaction.tenant.findUnique({
        where: { id: tenantId },
        select: tenantSelection,
      });
      if (!current) throw tenantNotFound();
      if (
        new Date(input.expectedUpdatedAt).getTime() !==
        current.updatedAt.getTime()
      ) {
        throw new ApplicationError(
          ErrorCode.PlatformTenantConflict,
          'The organization changed after it was loaded.',
          HttpStatus.CONFLICT,
        );
      }
      const nextPlan = input.plan ?? current.plan;
      const nextStatus = input.status ?? current.status;
      if (nextPlan === current.plan && nextStatus === current.status) {
        throw invalidTenant('The requested commercial state has no changes.');
      }

      const usage = await readStorageUsage(transaction, tenantId);
      const nextQuota = this.capacityPolicy.quotaFor(nextPlan);
      if (usage.usedBytes > nextQuota && !input.acknowledgeOverQuota) {
        throw new ApplicationError(
          ErrorCode.PlatformTenantConflict,
          'The selected plan is below the photographic evidence currently stored.',
          HttpStatus.CONFLICT,
          [{ usedBytes: usage.usedBytes, nextQuotaBytes: nextQuota }],
        );
      }

      const now = new Date();
      let revokedSessions = 0;
      let revokedRefreshTokens = 0;
      if (current.status === 'ACTIVE' && nextStatus !== 'ACTIVE') {
        revokedSessions = (
          await transaction.session.updateMany({
            where: { tenantId, status: 'ACTIVE' },
            data: {
              status: 'REVOKED',
              revokedAt: now,
              revokeReason: `PLATFORM_TENANT_${nextStatus}`,
            },
          })
        ).count;
        revokedRefreshTokens = (
          await transaction.refreshToken.updateMany({
            where: { tenantId, revokedAt: null },
            data: { revokedAt: now },
          })
        ).count;
      }

      await transaction.tenant.update({
        where: { id: tenantId },
        data: { plan: nextPlan, status: nextStatus },
      });
      await transaction.platformAuditEvent.create({
        data: {
          tenantId,
          operatorId: this.operatorId,
          eventType: 'PLATFORM_TENANT_COMMERCIAL_STATE_CHANGED',
          outcome: 'SUCCESS',
          reason,
          correlationId: request.correlationId,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent?.slice(0, 1024),
          metadata: {
            previous: { plan: current.plan, status: current.status },
            next: { plan: nextPlan, status: nextStatus },
            overQuotaAcknowledged:
              usage.usedBytes > nextQuota && input.acknowledgeOverQuota,
            usedBytes: usage.usedBytes,
            quotaBytes: nextQuota,
            revokedSessions,
            revokedRefreshTokens,
          },
        },
      });
    });
    return this.get(tenantId);
  }

  async listAuditEvents(
    query: PlatformAuditEventQueryDto,
  ): Promise<PlatformAuditEventPageResponseDto> {
    let cursorPosition: { createdAt: Date; id: string } | null = null;
    if (query.cursor) {
      cursorPosition = await this.prisma.platformAuditEvent.findUnique({
        where: { id: query.cursor },
        select: { createdAt: true, id: true },
      });
      if (!cursorPosition) throw invalidTenant('The audit cursor is invalid.');
    }
    const records = await this.prisma.platformAuditEvent.findMany({
      where: {
        tenantId: query.tenantId,
        ...(cursorPosition
          ? {
              OR: [
                { createdAt: { lt: cursorPosition.createdAt } },
                {
                  createdAt: cursorPosition.createdAt,
                  id: { lt: cursorPosition.id },
                },
              ],
            }
          : {}),
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = records.length > query.limit;
    const page = hasMore ? records.slice(0, query.limit) : records;
    return {
      items: page.map((record) => ({
        id: record.id,
        tenant: record.tenant,
        operatorId: record.operatorId,
        eventType: record.eventType,
        outcome: record.outcome,
        reason: record.reason,
        correlationId: record.correlationId,
        metadata: record.metadata,
        createdAt: record.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async enrich(
    tenant: TenantSnapshot,
  ): Promise<PlatformTenantResponseDto> {
    const operational = await this.tenantUnitOfWork.execute(
      tenant.id,
      async (transaction) => {
        const [userGroups, usage] = await Promise.all([
          transaction.user.groupBy({
            by: ['status'],
            where: { tenantId: tenant.id },
            _count: { _all: true },
          }),
          readStorageUsage(transaction, tenant.id),
        ]);
        return { userGroups, usage };
      },
    );
    const users: Record<UserStatus, number> = {
      ACTIVE: 0,
      INVITED: 0,
      LOCKED: 0,
      DISABLED: 0,
    };
    for (const group of operational.userGroups) {
      users[group.status] = group._count._all;
    }
    const quotaBytes = this.capacityPolicy.quotaFor(tenant.plan);
    return {
      ...tenant,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      users: {
        total: Object.values(users).reduce((sum, count) => sum + count, 0),
        active: users.ACTIVE,
        invited: users.INVITED,
        locked: users.LOCKED,
        disabled: users.DISABLED,
      },
      photographicEvidence: {
        usedBytes: operational.usage.usedBytes,
        quotaBytes,
        photoCount: operational.usage.photoCount,
        usagePercent: Number(
          ((operational.usage.usedBytes / quotaBytes) * 100).toFixed(2),
        ),
        capacityStatus: this.capacityPolicy.statusFor(
          operational.usage.usedBytes,
          quotaBytes,
        ),
        counterAvailable: operational.usage.counterAvailable,
      },
    };
  }
}

const tenantSelection = {
  id: true,
  name: true,
  slug: true,
  status: true,
  plan: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

async function readStorageUsage(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<{
  usedBytes: number;
  photoCount: number;
  counterAvailable: boolean;
}> {
  const counter = await transaction.tenantPhotoEvidenceUsage.findUnique({
    where: { tenantId },
    select: { usedBytes: true, photoCount: true },
  });
  if (counter) {
    return {
      usedBytes: Number(counter.usedBytes),
      photoCount: counter.photoCount,
      counterAvailable: true,
    };
  }
  const actual = await transaction.photoEvidence.aggregate({
    where: { tenantId },
    _sum: { sizeBytes: true },
    _count: { _all: true },
  });
  return {
    usedBytes: Number(actual._sum.sizeBytes ?? 0),
    photoCount: actual._count._all,
    counterAvailable: false,
  };
}

function batchesOf<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function tenantNotFound(): ApplicationError {
  return new ApplicationError(
    ErrorCode.PlatformTenantNotFound,
    'The organization was not found.',
    HttpStatus.NOT_FOUND,
  );
}

function invalidTenant(message: string): ApplicationError {
  return new ApplicationError(
    ErrorCode.PlatformTenantInvalid,
    message,
    HttpStatus.BAD_REQUEST,
  );
}

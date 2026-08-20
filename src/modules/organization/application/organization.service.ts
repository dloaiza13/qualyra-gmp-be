import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { PhotoEvidenceCapacityPolicy } from '../../photo-evidence/application/photo-evidence-capacity.policy.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import type { OrganizationCommercialSummaryDto } from './dto/organization-response.dto.js';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly tenantUnitOfWork: TenantUnitOfWork,
    private readonly capacityPolicy: PhotoEvidenceCapacityPolicy,
  ) {}

  summary(
    principal: AuthenticatedPrincipal,
  ): Promise<OrganizationCommercialSummaryDto> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const [tenant, activeUsers, totalUsers, pendingInvitations, counter] =
          await Promise.all([
            transaction.tenant.findFirst({
              where: { id: principal.tenantId },
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                plan: true,
                createdAt: true,
              },
            }),
            transaction.user.count({
              where: { tenantId: principal.tenantId, status: 'ACTIVE' },
            }),
            transaction.user.count({ where: { tenantId: principal.tenantId } }),
            transaction.invitation.count({
              where: { tenantId: principal.tenantId, status: 'PENDING' },
            }),
            transaction.tenantPhotoEvidenceUsage.findUnique({
              where: { tenantId: principal.tenantId },
              select: { usedBytes: true, photoCount: true },
            }),
          ]);
        if (!tenant) {
          throw new ApplicationError(
            ErrorCode.NotFound,
            'The organization was not found.',
            HttpStatus.NOT_FOUND,
          );
        }
        let usedBytes = Number(counter?.usedBytes ?? 0);
        let photoCount = counter?.photoCount ?? 0;
        if (!counter) {
          const actual = await transaction.photoEvidence.aggregate({
            where: { tenantId: principal.tenantId },
            _sum: { sizeBytes: true },
            _count: { _all: true },
          });
          usedBytes = Number(actual._sum.sizeBytes ?? 0);
          photoCount = actual._count._all;
        }
        const quotaBytes = this.capacityPolicy.quotaFor(tenant.plan);
        return {
          ...tenant,
          createdAt: tenant.createdAt.toISOString(),
          users: { total: totalUsers, active: activeUsers, pendingInvitations },
          photographicEvidence: {
            usedBytes,
            quotaBytes,
            remainingBytes: Math.max(0, quotaBytes - usedBytes),
            photoCount,
            usagePercent: Number(((usedBytes / quotaBytes) * 100).toFixed(2)),
            capacityStatus: this.capacityPolicy.statusFor(
              usedBytes,
              quotaBytes,
            ),
          },
          membership: 'INVITATION_ONLY',
          commercialManagement: 'PROVIDER_MANAGED',
        };
      },
    );
  }
}

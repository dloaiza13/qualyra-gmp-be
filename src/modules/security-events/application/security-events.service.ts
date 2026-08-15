import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../authentication/domain/authenticated-principal.js';
import { TenantUnitOfWork } from '../../tenancy/application/ports/tenant-unit-of-work.js';
import type {
  SecurityEventQueryDto,
  SecurityEventResponseDto,
} from './dto/security-event.dto.js';

@Injectable()
export class SecurityEventsService {
  constructor(private readonly tenantUnitOfWork: TenantUnitOfWork) {}

  list(
    principal: AuthenticatedPrincipal,
    query: SecurityEventQueryDto,
  ): Promise<SecurityEventResponseDto[]> {
    return this.tenantUnitOfWork.execute(
      principal.tenantId,
      async (transaction) => {
        const events = await transaction.securityEvent.findMany({
          where: {
            tenantId: principal.tenantId,
            eventType: query.eventType,
          },
          take: query.limit,
          orderBy: { createdAt: 'desc' },
          include: {
            actorUser: { select: { displayName: true } },
            subjectUser: { select: { displayName: true } },
          },
        });
        return events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          outcome: event.outcome,
          actor: event.actorUser?.displayName ?? null,
          subject: event.subjectUser?.displayName ?? null,
          correlationId: event.correlationId,
          ipAddress: event.ipAddress,
          metadata: event.metadata,
          createdAt: event.createdAt.toISOString(),
        }));
      },
    );
  }
}

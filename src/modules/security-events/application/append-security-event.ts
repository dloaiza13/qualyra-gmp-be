import type { Prisma } from '../../../generated/prisma/client.js';
import type { RequestMetadata } from '../../authentication/application/request-metadata.js';

export function appendSecurityEvent(
  transaction: Prisma.TransactionClient,
  input: {
    tenantId: string;
    actorUserId?: string;
    subjectUserId?: string;
    eventType: string;
    outcome: 'SUCCESS' | 'FAILURE';
    request: RequestMetadata;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<unknown> {
  return transaction.securityEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId,
      eventType: input.eventType,
      outcome: input.outcome,
      correlationId: input.request.correlationId,
      ipAddress: input.request.ipAddress,
      userAgent: input.request.userAgent?.slice(0, 1024),
      metadata: input.metadata,
    },
    select: { id: true },
  });
}

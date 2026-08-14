import type { Prisma } from '../../../../generated/prisma/client.js';

export type TenantWork<T> = (
  transaction: Prisma.TransactionClient,
) => Promise<T>;

export abstract class TenantUnitOfWork {
  abstract execute<T>(tenantId: string, work: TenantWork<T>): Promise<T>;
}

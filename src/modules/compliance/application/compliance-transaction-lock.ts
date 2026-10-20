import type { Prisma } from '../../../generated/prisma/client.js';

// Serialize compliance decisions for one tenant, including the first policy
// insert. Shared readers observe a complete decision rather than mixed versions.
export async function lockComplianceTenant(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  shared = false,
): Promise<void> {
  const key = `compliance:${tenantId}`;
  if (shared) {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))::text`;
  } else {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  }
}

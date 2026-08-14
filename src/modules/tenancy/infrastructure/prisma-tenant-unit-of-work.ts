import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service.js';
import {
  TenantUnitOfWork,
  type TenantWork,
} from '../application/ports/tenant-unit-of-work.js';

const tenantIdSchema = z.uuid();

@Injectable()
export class PrismaTenantUnitOfWork extends TenantUnitOfWork {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  execute<T>(tenantId: string, work: TenantWork<T>): Promise<T> {
    const validatedTenantId = tenantIdSchema.parse(tenantId);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT set_config('app.tenant_id', ${validatedTenantId}, true)
      `;
      return work(transaction);
    });
  }
}

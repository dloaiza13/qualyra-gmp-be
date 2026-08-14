import { Module } from '@nestjs/common';
import { TenantUnitOfWork } from '../../../modules/tenancy/application/ports/tenant-unit-of-work.js';
import { PrismaTenantUnitOfWork } from '../../../modules/tenancy/infrastructure/prisma-tenant-unit-of-work.js';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [
    PrismaService,
    PrismaTenantUnitOfWork,
    {
      provide: TenantUnitOfWork,
      useExisting: PrismaTenantUnitOfWork,
    },
  ],
  exports: [PrismaService, TenantUnitOfWork],
})
export class PrismaModule {}

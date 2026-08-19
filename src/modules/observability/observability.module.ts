import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { MetricsService } from './application/metrics.service.js';
import { HttpMetricsInterceptor } from './presentation/http-metrics.interceptor.js';
import { MetricsController } from './presentation/metrics.controller.js';

@Global()
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}

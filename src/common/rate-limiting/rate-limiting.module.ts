import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

@Module({
  imports: [RedisModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class RateLimitingModule {}

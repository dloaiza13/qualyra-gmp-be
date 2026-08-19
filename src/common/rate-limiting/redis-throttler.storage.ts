import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Environment } from '../config/environment.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

const incrementScript = `
local block_ttl = redis.call('PTTL', KEYS[2])
if block_ttl > 0 then
  local total = tonumber(redis.call('GET', KEYS[1]))
  if not total then total = tonumber(ARGV[2]) + 1 end
  local window_ttl = redis.call('PTTL', KEYS[1])
  if window_ttl < 1 then window_ttl = tonumber(ARGV[1]) end
  return {total, math.ceil(window_ttl / 1000), 1, math.ceil(block_ttl / 1000)}
end

local total = redis.call('INCR', KEYS[1])
if total == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local window_ttl = redis.call('PTTL', KEYS[1])

if total > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {total, math.ceil(window_ttl / 1000), 1, math.ceil(tonumber(ARGV[3]) / 1000)}
end

return {total, math.ceil(window_ttl / 1000), 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
  ) {
    this.keyPrefix =
      config.getOrThrow('NODE_ENV', { infer: true }) === 'test'
        ? `qualyra:test:${randomUUID()}`
        : 'qualyra';
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorage['increment']> {
    const keyPrefix = `${this.keyPrefix}:throttle:${throttlerName}:{${key}}`;
    const result = await this.redis.evaluate(
      incrementScript,
      [`${keyPrefix}:hits`, `${keyPrefix}:blocked`],
      [String(ttl), String(limit), String(blockDuration)],
    );
    if (!isThrottleResult(result)) {
      throw new Error('INVALID_REDIS_THROTTLE_RESULT');
    }
    return {
      totalHits: result[0],
      timeToExpire: result[1],
      isBlocked: result[2] === 1,
      timeToBlockExpire: result[3],
    };
  }
}

function isThrottleResult(
  value: unknown,
): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

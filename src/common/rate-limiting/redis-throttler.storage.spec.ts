import type { RedisService } from '../../infrastructure/redis/redis.service.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../config/environment.js';

describe('RedisThrottlerStorage', () => {
  it('maps the atomic Redis result to the throttler contract', async () => {
    const evaluate = jest
      .fn<RedisService['evaluate']>()
      .mockResolvedValue([3, 42, 1, 17]);
    const redis = {
      evaluate,
    } as unknown as RedisService;
    const storage = createStorage(redis);

    await expect(
      storage.increment('hash', 60_000, 2, 30_000, 'identity'),
    ).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 17,
    });
    expect(evaluate).toHaveBeenCalledWith(
      expect.any(String),
      [
        'qualyra:throttle:identity:{hash}:hits',
        'qualyra:throttle:identity:{hash}:blocked',
      ],
      ['60000', '2', '30000'],
    );
  });

  it('rejects malformed Redis responses instead of bypassing protection', async () => {
    const redis = {
      evaluate: jest
        .fn<RedisService['evaluate']>()
        .mockResolvedValue('unexpected'),
    } as unknown as RedisService;

    await expect(
      createStorage(redis).increment('hash', 60_000, 2, 30_000, 'default'),
    ).rejects.toThrow('INVALID_REDIS_THROTTLE_RESULT');
  });
});

function createStorage(redis: RedisService): RedisThrottlerStorage {
  const config = new ConfigService<Environment, true>({
    NODE_ENV: 'development',
  });
  return new RedisThrottlerStorage(redis, config);
}

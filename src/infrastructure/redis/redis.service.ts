import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import type { Environment } from '../../common/config/environment.js';

type RedisClient = ReturnType<typeof createClient>;

@Injectable()
export class RedisService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClient;
  private readonly operationTimeoutMs: number;
  private connection?: Promise<void>;

  constructor(config: ConfigService<Environment, true>) {
    const connectTimeout = config.getOrThrow('REDIS_CONNECT_TIMEOUT_MS', {
      infer: true,
    });
    this.operationTimeoutMs = config.getOrThrow('REDIS_OPERATION_TIMEOUT_MS', {
      infer: true,
    });
    this.client = createClient({
      url: config.getOrThrow('REDIS_URL', { infer: true }),
      disableOfflineQueue: true,
      socket: {
        connectTimeout,
        reconnectStrategy: (attempts) =>
          attempts >= 3 ? false : Math.min(100 * 2 ** attempts, 1_000),
      },
    });
    this.client.on('error', () => {
      this.logger.warn('Redis connection is unavailable');
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureConnected().catch(() => {
      this.logger.warn(
        'Redis was unavailable at startup; readiness and protected requests will fail until it recovers',
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close().catch(() => this.client.destroy());
    }
  }

  async ping(): Promise<void> {
    await this.ensureConnected();
    const reply = await this.withTimeout(this.client.ping());
    if (reply !== 'PONG') throw new Error('REDIS_PING_FAILED');
  }

  async evaluate(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    await this.ensureConnected();
    return this.withTimeout(
      this.client.eval(script, { keys, arguments: args }),
    );
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.client.isOpen) {
      this.connection ??= this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connection = undefined;
        });
    }
    if (this.connection) await this.connection;
    if (!this.client.isReady) throw new Error('REDIS_NOT_READY');
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('REDIS_OPERATION_TIMEOUT')),
            this.operationTimeoutMs,
          );
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

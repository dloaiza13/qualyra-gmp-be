import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, RouterModule } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import {
  validateEnvironment,
  type Environment,
} from './common/config/environment.js';
import { credentialThrottleTracker } from './common/rate-limiting/credential-throttle-tracker.js';
import {
  CorrelationIdMiddleware,
  isCorrelationId,
} from './common/request-context/correlation-id.middleware.js';
import { CryptoModule } from './infrastructure/crypto/crypto.module.js';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module.js';
import { EmailModule } from './infrastructure/email/email.module.js';
import { AuthenticationModule } from './modules/authentication/authentication.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) => ({
        pinoHttp: {
          level:
            configService.getOrThrow('NODE_ENV', { infer: true }) === 'test'
              ? 'silent'
              : 'info',
          genReqId: (request) => {
            const incoming = request.headers['x-correlation-id'];
            return isCorrelationId(incoming) ? incoming : randomUUID();
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers.set-cookie',
              'req.body.password',
              'req.body.newPassword',
              'req.body.currentPassword',
              'req.body.refreshToken',
              'req.body.resetToken',
              'req.body.verificationToken',
              'req.body.token',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 120 },
        {
          name: 'identity',
          ttl: 60_000,
          limit: 120,
          getTracker: credentialThrottleTracker,
        },
      ],
    }),
    CryptoModule,
    EmailModule,
    PrismaModule,
    HealthModule,
    AuthenticationModule,
    RouterModule.register([{ path: 'api/v1', module: AuthenticationModule }]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes({
      path: '{*path}',
      method: RequestMethod.ALL,
    });
  }
}

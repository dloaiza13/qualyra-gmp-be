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
import { sanitizeLoggedRequest } from './common/logging/http-log-sanitizer.js';
import {
  CorrelationIdMiddleware,
  isCorrelationId,
} from './common/request-context/correlation-id.middleware.js';
import { CryptoModule } from './infrastructure/crypto/crypto.module.js';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module.js';
import { EmailModule } from './infrastructure/email/email.module.js';
import { AuthenticationModule } from './modules/authentication/authentication.module.js';
import { CapasModule } from './modules/capas/capas.module.js';
import { ChangeControlsModule } from './modules/change-controls/change-controls.module.js';
import { AuditsModule } from './modules/audits/audits.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { DeviationsModule } from './modules/deviations/deviations.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { SecurityEventsModule } from './modules/security-events/security-events.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { TrainingModule } from './modules/training/training.module.js';
import { NotificationOutboxModule } from './modules/notifications/notification-outbox.module.js';
import { NotificationDeliveriesModule } from './modules/notifications/notification-deliveries.module.js';
import { RateLimitingModule } from './common/rate-limiting/rate-limiting.module.js';
import { RedisThrottlerStorage } from './common/rate-limiting/redis-throttler.storage.js';
import { ObservabilityModule } from './modules/observability/observability.module.js';

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
          serializers: {
            req: sanitizeLoggedRequest,
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.confirmPassword',
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
    RateLimitingModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitingModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        storage,
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
    }),
    CryptoModule,
    EmailModule,
    PrismaModule,
    ObservabilityModule,
    NotificationOutboxModule,
    HealthModule,
    AuthenticationModule,
    CapasModule,
    ChangeControlsModule,
    AuditsModule,
    DocumentsModule,
    TrainingModule,
    DeviationsModule,
    InvitationsModule,
    UsersModule,
    RolesModule,
    SecurityEventsModule,
    NotificationDeliveriesModule,
    RouterModule.register([
      { path: 'api/v1', module: AuthenticationModule },
      { path: 'api/v1', module: CapasModule },
      { path: 'api/v1', module: ChangeControlsModule },
      { path: 'api/v1', module: AuditsModule },
      { path: 'api/v1', module: DocumentsModule },
      { path: 'api/v1', module: TrainingModule },
      { path: 'api/v1', module: DeviationsModule },
      { path: 'api/v1', module: InvitationsModule },
      { path: 'api/v1', module: UsersModule },
      { path: 'api/v1', module: RolesModule },
      { path: 'api/v1', module: SecurityEventsModule },
      { path: 'api/v1', module: NotificationDeliveriesModule },
    ]),
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

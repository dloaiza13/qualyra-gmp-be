import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import type { Server } from 'node:http';
import { SwaggerModule } from '@nestjs/swagger';
import {
  parseAllowedOrigins,
  type Environment,
} from './common/config/environment.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { createValidationException } from './common/validation/validation-exception.factory.js';
import { createOpenApiDocument } from './openapi.js';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  const origins = parseAllowedOrigins(
    config.getOrThrow('CORS_ALLOWED_ORIGINS', { infer: true }),
  );
  const bodyLimit = config.getOrThrow('REQUEST_BODY_LIMIT', { infer: true });
  const express = app.getHttpAdapter().getInstance() as Express;
  const server = app.getHttpServer() as Server;

  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.keepAliveTimeout = 5_000;

  express.set(
    'trust proxy',
    parseTrustProxy(config.getOrThrow('TRUST_PROXY', { infer: true })),
  );
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: false, limit: bodyLimit }));
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'x-correlation-id',
      'x-csrf-token',
    ],
    exposedHeaders: ['x-correlation-id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  if (config.getOrThrow('NODE_ENV', { infer: true }) === 'development') {
    SwaggerModule.setup('api/docs', app, createOpenApiDocument(app));
  }
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : value;
}

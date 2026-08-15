import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { RequestWithContext } from './request-with-context.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(
    request: Request & RequestWithContext,
    response: Response,
    next: NextFunction,
  ): void {
    const incoming = request.header('x-correlation-id');
    const loggerRequestId = (request as Request & { id?: unknown }).id;
    const correlationId = isCorrelationId(incoming)
      ? incoming
      : isCorrelationId(loggerRequestId)
        ? loggerRequestId
        : randomUUID();

    request.correlationId = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    next();
  }
}

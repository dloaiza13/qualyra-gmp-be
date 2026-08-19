import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../application/metrics.service.js';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = performance.now();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    let recorded = false;
    const record = (statusCode: number): void => {
      if (recorded) return;
      recorded = true;
      this.metrics.recordHttpRequest({
        method: request.method,
        route,
        statusCode,
        durationSeconds: Math.max(0, performance.now() - startedAt) / 1_000,
      });
    };
    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (error: unknown) => record(httpStatus(error)),
      }),
    );
  }
}

function httpStatus(error: unknown): number {
  if (hasHttpStatus(error)) {
    const status = error.getStatus();
    if (typeof status === 'number') return status;
  }
  return 500;
}

function hasHttpStatus(value: unknown): value is { getStatus(): unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'getStatus' in value &&
    typeof value.getStatus === 'function'
  );
}

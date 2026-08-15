import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApplicationError } from '../errors/application-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { RequestWithContext } from '../request-context/request-with-context.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & RequestWithContext>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const fallback = genericError(status);

    if (status >= 500) {
      this.logger.error(
        {
          correlationId: request.correlationId ?? 'unknown',
          statusCode: status,
          exceptionName:
            exception instanceof Error ? exception.name : 'UnknownError',
        },
        'Unhandled HTTP exception',
      );
    }

    response.status(status).json({
      statusCode: status,
      code:
        exception instanceof ApplicationError ? exception.code : fallback.code,
      message:
        exception instanceof ApplicationError
          ? exception.message
          : fallback.message,
      details: exception instanceof ApplicationError ? exception.details : [],
      correlationId: request.correlationId ?? 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}

function genericError(status: number): { code: string; message: string } {
  switch (status) {
    case 400:
      return {
        code: ErrorCode.ValidationError,
        message: 'The request is invalid.',
      };
    case 401:
      return {
        code: ErrorCode.Unauthorized,
        message: 'Authentication is required.',
      };
    case 403:
      return {
        code: ErrorCode.Forbidden,
        message: 'The operation is forbidden.',
      };
    case 404:
      return {
        code: ErrorCode.NotFound,
        message: 'The requested resource was not found.',
      };
    case 429:
      return {
        code: ErrorCode.RateLimitExceeded,
        message: 'Too many requests were received.',
      };
    default:
      return {
        code: ErrorCode.InternalError,
        message: 'An unexpected error occurred.',
      };
  }
}

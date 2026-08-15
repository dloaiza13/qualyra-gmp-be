import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorDetail = Readonly<Record<string, unknown>>;

export class ApplicationError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly details: readonly ErrorDetail[] = [],
  ) {
    super(message, status);
  }
}

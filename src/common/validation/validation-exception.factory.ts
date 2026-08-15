import { HttpStatus, type ValidationError } from '@nestjs/common';
import { ApplicationError } from '../errors/application-error.js';
import { ErrorCode } from '../errors/error-codes.js';

export function createValidationException(
  errors: ValidationError[],
): ApplicationError {
  return new ApplicationError(
    ErrorCode.ValidationError,
    'The request is invalid.',
    HttpStatus.BAD_REQUEST,
    flattenErrors(errors),
  );
}

function flattenErrors(
  errors: ValidationError[],
  parent = '',
): Readonly<Record<string, unknown>>[] {
  return errors.flatMap((error) => {
    const property = parent ? `${parent}.${error.property}` : error.property;
    const current = error.constraints
      ? [{ field: property, constraints: Object.keys(error.constraints) }]
      : [];
    return [...current, ...flattenErrors(error.children ?? [], property)];
  });
}

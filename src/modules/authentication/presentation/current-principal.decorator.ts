import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithContext } from '../../../common/request-context/request-with-context.js';
import type { AuthenticatedPrincipal } from '../domain/authenticated-principal.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context
      .switchToHttp()
      .getRequest<Request & RequestWithContext>();
    if (!request.principal) {
      throw new Error('Authenticated principal is unavailable.');
    }
    return request.permissions
      ? {
          ...request.principal,
          effectivePermissions: request.permissions,
        }
      : request.principal;
  },
);

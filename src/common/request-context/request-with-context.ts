import type { AuthenticatedPrincipal } from '../../modules/authentication/domain/authenticated-principal.js';

export interface RequestWithContext {
  correlationId: string;
  principal?: AuthenticatedPrincipal;
  permissions?: string[];
}

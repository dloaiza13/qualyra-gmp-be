export interface AuthenticatedPrincipal {
  userId: string;
  tenantId: string;
  sessionId: string;
  tokenVersion: number;
  effectivePermissions?: readonly string[];
}

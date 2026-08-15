interface ThrottleRequest {
  ip?: unknown;
  body?: unknown;
}

export function credentialThrottleTracker(
  request: ThrottleRequest,
): Promise<string> {
  const identity = readCredentialIdentity(request.body);
  const ipAddress =
    typeof request.ip === 'string' && request.ip.length > 0
      ? request.ip
      : 'unknown-ip';
  return Promise.resolve(identity ?? ipAddress);
}

function readCredentialIdentity(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const values = body as Record<string, unknown>;
  const tenant = normalize(values.tenant ?? values.tenantSlug);
  const email = normalize(values.email);
  return tenant && email ? `${tenant}:${email}` : undefined;
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

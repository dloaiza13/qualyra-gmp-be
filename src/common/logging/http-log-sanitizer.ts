export function sanitizeRequestUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const queryIndex = value.indexOf('?');
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

export function sanitizeLoggedRequest(
  request: unknown,
): Record<string, unknown> {
  if (request === null || typeof request !== 'object') {
    return {};
  }

  const serializedRequest = request as Record<string, unknown>;

  return {
    ...serializedRequest,
    url: sanitizeRequestUrl(serializedRequest.url),
    query: undefined,
  };
}

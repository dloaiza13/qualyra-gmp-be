import {
  sanitizeLoggedRequest,
  sanitizeRequestUrl,
} from './http-log-sanitizer.js';

describe('sanitizeRequestUrl', () => {
  it('removes every query parameter from logged URLs', () => {
    expect(
      sanitizeRequestUrl(
        '/verify-email?token=secret-token&email=user%40example.test',
      ),
    ).toBe('/verify-email');
  });

  it('preserves a URL without a query and rejects non-string values', () => {
    expect(sanitizeRequestUrl('/api/v1/users')).toBe('/api/v1/users');
    expect(sanitizeRequestUrl(undefined)).toBeUndefined();
  });

  it('removes query values from a serialized request', () => {
    expect(
      sanitizeLoggedRequest({
        method: 'GET',
        url: '/verify-email?token=secret-token',
        query: { token: 'secret-token' },
      }),
    ).toEqual({
      method: 'GET',
      url: '/verify-email',
      query: undefined,
    });
  });
});

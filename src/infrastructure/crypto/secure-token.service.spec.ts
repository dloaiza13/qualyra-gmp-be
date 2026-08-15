import { SecureTokenService } from './secure-token.service.js';

describe('SecureTokenService', () => {
  const service = new SecureTokenService();

  it('creates an opaque token and persists only a SHA-256 digest', () => {
    const tenantId = 'bce748c7-371b-41a0-8ff0-d7de5c7c103b';
    const token = service.create(tenantId);

    expect(token.raw).toMatch(new RegExp(`^v1\\.${tenantId}\\.`));
    expect(token.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.raw).not.toContain(token.hash);
    expect(service.parse(token.raw)).toEqual({
      tenantId,
      tokenId: token.id,
      hash: token.hash,
    });
  });

  it('rejects malformed tokens', () => {
    expect(service.parse('not-a-token')).toBeUndefined();
    expect(service.parse('v1.invalid.invalid.invalid')).toBeUndefined();
  });
});

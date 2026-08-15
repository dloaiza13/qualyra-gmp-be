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

  it('rotates the secret while preserving an existing token identifier', () => {
    const tenantId = 'bce748c7-371b-41a0-8ff0-d7de5c7c103b';
    const tokenId = '5cd3ed03-4f5e-40af-bcb6-6d92d9490664';
    const first = service.create(tenantId, tokenId);
    const rotated = service.create(tenantId, tokenId);

    expect(rotated.id).toBe(tokenId);
    expect(rotated.raw).not.toBe(first.raw);
    expect(rotated.hash).not.toBe(first.hash);
    expect(service.parse(rotated.raw)?.tokenId).toBe(tokenId);
  });
});

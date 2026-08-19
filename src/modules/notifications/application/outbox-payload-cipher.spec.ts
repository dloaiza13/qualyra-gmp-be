import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import { OutboxPayloadCipher } from './outbox-payload-cipher.js';

describe('OutboxPayloadCipher', () => {
  const cipher = new OutboxPayloadCipher(
    new ConfigService<Environment, true>({
      OUTBOX_PAYLOAD_ENCRYPTION_KEY:
        'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100',
    } as Environment),
  );

  it('encrypts notification secrets and restores them only in the same context', () => {
    const payload = { token: 'one-time-secret', email: 'qa@example.test' };
    const encrypted = cipher.encrypt(payload, 'tenant:type:key');

    expect(JSON.stringify(encrypted)).not.toContain(payload.token);
    expect(cipher.decrypt(encrypted, 'tenant:type:key')).toEqual(payload);
    expect(() => cipher.decrypt(encrypted, 'another:type:key')).toThrow();
  });

  it('rejects malformed envelopes', () => {
    expect(() => cipher.decrypt({ version: 1 }, 'tenant:type:key')).toThrow();
  });
});

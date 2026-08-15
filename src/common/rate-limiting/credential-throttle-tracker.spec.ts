import { credentialThrottleTracker } from './credential-throttle-tracker.js';

describe('credentialThrottleTracker', () => {
  it('normalizes tenant and email independently from the source IP', async () => {
    await expect(
      credentialThrottleTracker({
        ip: '127.0.0.1',
        body: { tenant: ' ACME ', email: ' USER@EXAMPLE.TEST ' },
      }),
    ).resolves.toBe('acme:user@example.test');
  });

  it('uses the trusted Express IP when credentials are absent', async () => {
    await expect(
      credentialThrottleTracker({ ip: '127.0.0.1', body: {} }),
    ).resolves.toBe('127.0.0.1');
  });
});

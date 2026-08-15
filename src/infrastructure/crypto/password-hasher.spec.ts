import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('stores passwords with Argon2id and verifies the correct value', async () => {
    const password = 'A sufficiently long passphrase!';
    const hash = await hasher.hash(password);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(password);
    await expect(hasher.verify(hash, password)).resolves.toBe(true);
    await expect(hasher.verify(hash, 'the wrong password')).resolves.toBe(
      false,
    );
  });

  it('performs a dummy verification without exposing the dummy hash', async () => {
    await expect(
      hasher.verifyDummy('arbitrary value'),
    ).resolves.toBeUndefined();
  });
});

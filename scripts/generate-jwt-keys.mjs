import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const force = process.argv.includes('--force');
const keyDirectory = resolve('.local', 'keys');
const privateKeyPath = resolve(keyDirectory, 'jwt-private.pem');
const publicKeyPath = resolve(keyDirectory, 'jwt-public.pem');

if (!force && (existsSync(privateKeyPath) || existsSync(publicKeyPath))) {
  process.stderr.write(
    'JWT keys already exist. Use --force only when intentional token invalidation is acceptable.\n',
  );
  process.exitCode = 1;
} else {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  mkdirSync(keyDirectory, { recursive: true });
  writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { encoding: 'utf8', mode: 0o644 });
  process.stdout.write(`Generated local JWT keys in ${keyDirectory}.\n`);
}

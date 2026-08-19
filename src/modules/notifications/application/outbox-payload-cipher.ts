import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Environment } from '../../../common/config/environment.js';
import type { Prisma } from '../../../generated/prisma/client.js';

const envelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('A256GCM'),
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
});

@Injectable()
export class OutboxPayloadCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    const encodedKey = config.getOrThrow('OUTBOX_PAYLOAD_ENCRYPTION_KEY', {
      infer: true,
    });
    this.key = Buffer.from(String(encodedKey), 'hex');
  }

  encrypt(value: unknown, context: string): Prisma.JsonObject {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return {
      version: 1,
      algorithm: 'A256GCM',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  decrypt(value: Prisma.JsonValue, context: string): unknown {
    const envelope = envelopeSchema.parse(value);
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.length !== 12 || tag.length !== 16) {
      throw new Error('Invalid outbox encryption envelope.');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  }
}

import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

const tokenEnvelopeSchema = z.tuple([
  z.literal('v1'),
  z.uuid(),
  z.uuid(),
  z.string().min(40).max(200),
]);

export interface PersistedToken {
  id: string;
  raw: string;
  hash: string;
}

export interface ParsedToken {
  tenantId: string;
  tokenId: string;
  hash: string;
}

@Injectable()
export class SecureTokenService {
  create(tenantId: string): PersistedToken {
    const id = randomUUID();
    const secret = randomBytes(48).toString('base64url');
    const raw = `v1.${tenantId}.${id}.${secret}`;
    return { id, raw, hash: this.hash(raw) };
  }

  createCsrfToken(): string {
    return randomBytes(32).toString('base64url');
  }

  parse(raw: string): ParsedToken | undefined {
    const result = tokenEnvelopeSchema.safeParse(raw.split('.'));
    if (!result.success) return undefined;

    const [, tenantId, tokenId] = result.data;
    return { tenantId, tokenId, hash: this.hash(raw) };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}

import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../common/config/environment.js';
import {
  CapaEvidenceStorage,
  type StoredEvidenceObject,
} from '../domain/ports/capa-evidence-storage.js';

@Injectable()
export class LocalCapaEvidenceStorage extends CapaEvidenceStorage {
  private readonly root: string;

  constructor(config: ConfigService<Environment, true>) {
    super();
    this.root = resolve(
      config.getOrThrow('CAPA_EVIDENCE_STORAGE_ROOT', { infer: true }),
    );
  }

  async checkHealth(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.R_OK | constants.W_OK);
  }

  async store(
    objectKey: string,
    bytes: Buffer,
    contentType: string,
    sha256: string,
  ): Promise<StoredEvidenceObject> {
    void contentType;
    void sha256;
    const path = this.resolveObject(objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
    return { objectKey, storageDriver: 'LOCAL' };
  }

  read(objectKey: string): Promise<Buffer> {
    return readFile(this.resolveObject(objectKey));
  }

  async remove(objectKey: string): Promise<void> {
    await rm(this.resolveObject(objectKey), { force: true });
  }

  private resolveObject(objectKey: string): string {
    const path = resolve(this.root, ...objectKey.split('/'));
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid managed evidence object key.');
    }
    return path;
  }
}

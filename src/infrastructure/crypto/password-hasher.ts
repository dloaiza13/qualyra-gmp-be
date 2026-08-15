import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

@Injectable()
export class PasswordHasher {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(password, options);
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('qualyra-dummy-password-never-used');
    await this.verify(await this.dummyHash, password);
  }
}

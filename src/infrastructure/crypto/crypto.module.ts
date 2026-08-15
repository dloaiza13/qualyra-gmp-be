import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenService } from './access-token.service.js';
import { PasswordHasher } from './password-hasher.js';
import { SecureTokenService } from './secure-token.service.js';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessTokenService, PasswordHasher, SecureTokenService],
  exports: [AccessTokenService, PasswordHasher, SecureTokenService],
})
export class CryptoModule {}

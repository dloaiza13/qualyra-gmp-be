import { Global, Module } from '@nestjs/common';
import { AuthenticationNotifier } from '../../modules/authentication/domain/ports/authentication-notifier.js';
import { SmtpAuthenticationNotifier } from './smtp-authentication-notifier.js';

@Global()
@Module({
  providers: [
    SmtpAuthenticationNotifier,
    {
      provide: AuthenticationNotifier,
      useExisting: SmtpAuthenticationNotifier,
    },
  ],
  exports: [AuthenticationNotifier],
})
export class EmailModule {}

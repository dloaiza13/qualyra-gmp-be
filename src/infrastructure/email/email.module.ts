import { Global, Module } from '@nestjs/common';
import { AuthenticationNotifier } from '../../modules/authentication/domain/ports/authentication-notifier.js';
import { CapaMonitoringNotifier } from '../../modules/capas/domain/ports/capa-monitoring-notifier.js';
import { SmtpAuthenticationNotifier } from './smtp-authentication-notifier.js';
import { SmtpCapaMonitoringNotifier } from './smtp-capa-monitoring-notifier.js';

@Global()
@Module({
  providers: [
    SmtpAuthenticationNotifier,
    SmtpCapaMonitoringNotifier,
    {
      provide: AuthenticationNotifier,
      useExisting: SmtpAuthenticationNotifier,
    },
    {
      provide: CapaMonitoringNotifier,
      useExisting: SmtpCapaMonitoringNotifier,
    },
  ],
  exports: [AuthenticationNotifier, CapaMonitoringNotifier],
})
export class EmailModule {}

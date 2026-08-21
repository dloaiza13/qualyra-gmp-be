import { Module } from '@nestjs/common';
import { CommercialEntitlementPolicy } from './application/commercial-entitlement.policy.js';

@Module({
  providers: [CommercialEntitlementPolicy],
  exports: [CommercialEntitlementPolicy],
})
export class CommercialEntitlementsModule {}

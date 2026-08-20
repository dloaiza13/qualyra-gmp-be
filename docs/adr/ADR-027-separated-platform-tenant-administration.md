# ADR-027: Separate platform tenant administration

## Status

Accepted.

## Decision

Keep commercial tenant administration outside normal tenant identities. Expose a disabled-by-default, private-network API authenticated with a dedicated opaque operator token. Allow bounded tenant inventory, plan changes, suspension/reactivation, and immutable global audit history. Give authenticated customer users only their own commercial summary.

Suspension revokes current tenant sessions and refresh tokens in the same transaction as the status change. Plan downgrades below stored photographic evidence require explicit acknowledgement and never delete evidence.

## Consequences

This preserves the RLS boundary and avoids a tenant role with global authority. Initial operations can support controlled sales without a billing provider or an internal workforce identity system. The shared operator token must be protected and rotated, and production should later replace it with named workforce identities, SSO, MFA, scoped roles, and approval workflows.

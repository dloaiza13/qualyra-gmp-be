# ADR-029: Provider-neutral subscription lifecycle

## Status

Accepted.

## Context

Plan entitlements alone cannot represent renewals, payment grace, scheduled cancellation, or provider event delivery. Regulated customer records must remain available when commercial write access ends, and repeated or out-of-order provider callbacks must not corrupt state.

## Decision

- Store one tenant subscription separately from the tenant plan.
- Derive deadline expiration during authorization instead of depending on a scheduler.
- Preserve inactive subscriptions in read-only mode.
- Serialize lifecycle changes with the existing tenant commercial advisory lock and optimistic concurrency.
- Store normalized provider events in an immutable ledger with a provider-scoped idempotency key, canonical payload hash, and event-order check.
- Keep provider signature verification in a future adapter; the current endpoint remains behind the private platform control.

## Consequences

Manual commercial operations and future payment providers share one lifecycle without coupling the core domain to a vendor. Renewal and cancellation are visible and audited immediately. A provider adapter, secret rotation procedure, signature verification, and provider-specific reconciliation are still required before exposing a public webhook.

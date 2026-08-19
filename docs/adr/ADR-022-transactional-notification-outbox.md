# ADR-022: Transactional notification outbox

## Status

Accepted.

## Decision

Persist every application email in the tenant transaction that creates the corresponding business state. Encrypt payloads with AES-256-GCM, deduplicate enqueue operations per tenant, and deliver them from a lease-based worker after commit. Retry transient failures with bounded exponential backoff and move exhausted work to a manually recoverable dead-letter state.

The delivery API exposes metadata only and is protected by tenant RLS plus explicit read/retry permissions. Manual recovery is security-audited. Successful and domain-cancelled payloads are purged.

## Consequences

- A committed business operation cannot silently lose its email intent because of an API crash.
- External SMTP calls no longer extend tenant database transactions.
- Multiple API instances may run workers concurrently without intentionally delivering the same claim.
- SMTP still permits a duplicate if the worker crashes after provider acceptance and before marking success; stable message identifiers mitigate but cannot eliminate this boundary.
- The encryption key becomes production secret material and needs an explicit drain or key-ring rotation procedure.
- Provider delivery webhooks, bounces, suppressions, metrics export, and a dedicated queue process remain later deployment integrations.

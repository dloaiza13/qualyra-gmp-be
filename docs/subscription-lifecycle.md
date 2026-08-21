# Subscription lifecycle

Qualyra stores one subscription state per tenant independently from its plan. The plan answers which limits and modules apply; the subscription answers whether commercial write access is currently valid.

## States

| Persisted state         | Effective behavior                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `TRIALING`              | Writable until `currentPeriodEndsAt`; afterwards it is effectively `EXPIRED`.                |
| `ACTIVE`                | Writable. A period end may be recorded for renewal visibility.                               |
| `GRACE_PERIOD`          | Writable until `graceEndsAt`; afterwards it is effectively `EXPIRED`.                        |
| `CANCEL_SCHEDULED`      | Writable until `currentPeriodEndsAt`; afterwards it is effectively `CANCELED`.               |
| `CANCELED` or `EXPIRED` | Historical data remains readable; mutations, invitations, and seat reactivation are blocked. |

Effective expiration is calculated at request time, so access does not depend on a background job running at the exact deadline. The persisted transition and every operator or provider action remain auditable.

## Private operator actions

`PATCH /api/v1/platform/tenants/:tenantId/subscription` accepts `RENEW`, `START_GRACE_PERIOD`, `SCHEDULE_CANCELLATION`, `CANCEL_NOW`, or `REACTIVATE`. It requires a meaningful reason and the last observed subscription `expectedUpdatedAt` value. Renewal and reactivation require a future period end and, for paid plans, a billing interval.

## Provider-neutral event boundary

`POST /api/v1/platform/tenants/:tenantId/billing-events` accepts normalized provider events through the same private platform boundary. This is not a public webhook endpoint. A future provider adapter must verify the provider signature, resolve the tenant, normalize the event, and then invoke this boundary.

Events are immutable and idempotent by `(provider, providerEventId)`. Replays with the same normalized payload return the original receipt; reusing an identifier with a different payload returns `BILLING_EVENT_CONFLICT`. Events older than the last applied provider event are retained as `IGNORED` and cannot roll the subscription backwards.

Supported normalized types are activation, renewal, payment failure, scheduled cancellation, cancellation, reactivation, and trial expiration. No card data, secrets, or raw provider payloads are stored.

## Deployment

Apply migration `20260820070000_subscription_lifecycle`. It creates and backfills subscriptions, enables forced tenant RLS, and creates the append-only provider event ledger. Existing paid tenants are backfilled as active with no known period end; operators can record the next renewal through the private console.

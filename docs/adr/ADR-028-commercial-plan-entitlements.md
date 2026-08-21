# ADR-028: Compliance-safe commercial plan entitlements

## Status

Accepted.

## Context

Qualyra needs enforceable product plans before payment-provider automation. Limits must control resource growth and feature access without destroying regulated records or relying on frontend-only hiding. Pending invitations and concurrent operator actions also need deterministic seat accounting.

## Decision

- Centralize plan definitions and effective-permission calculation in one backend commercial entitlement policy.
- Count every non-disabled user and every non-expired pending invitation as a committed seat.
- Serialize invitation creation, invitation acceptance, user reactivation, and commercial plan changes with the same tenant-scoped advisory lock.
- Preserve excluded-module and expired-trial data as read-only.
- Require explicit, audited operator acknowledgement when a downgrade is below current storage or committed-user usage.
- Return effective permissions and entitlement summaries to the frontend while retaining the backend guard as the authority.

## Consequences

Downgrades are reversible and compliance-safe, and commercial limits cannot be bypassed by concurrent invitation or reactivation requests. Starter customers retain historical visibility into non-writable modules. The initial matrix remains code-versioned and requires a deployment to change; configurable catalogs, billing-provider webhooks, metered add-ons, and self-service upgrades remain future work.

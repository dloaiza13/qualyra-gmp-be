# ADR-016: Immutable CAPA plan and authenticated action execution

## Status

Accepted — 2026-08-18

## Context

A CAPA plan translates an approved root-cause conclusion into future obligations. Silent edits to action scope, responsibility, or target dates would make later completion evidence ambiguous. Storing a mutable aggregate status would also create a second source of truth that could disagree with its actions. Conversely, this phase does not yet have the independent effectiveness decision needed to claim that a completed implementation resolved the root cause.

Action completion is attributable quality evidence. An authenticated browser session alone does not demonstrate the assigned person's intent at the moment of completion.

## Decision

Allow one CAPA per tenant and completed deviation investigation, only when the immutable investigation requires CAPA. Create the plan, one or more typed actions, and a tenant/year human-readable sequence in one transaction. Lock the plan after action insertion. Database triggers validate the source, require actions, reject later plan mutation or deletion, and prevent appending actions after the lock.

Keep action definitions immutable. Permit only one `OPEN` to `COMPLETED` transition by the assigned active user with `capas.execute`. Reauthenticate the current password, reconfirm the unchanged password hash and active session in the business transaction, and require explicit attestation. Store a fixed meaning, authentication method, completion comment, actor-bound session, timestamp, and canonical SHA-256 fingerprint rooted in the investigation record hash.

Derive `OPEN`, `IN_PROGRESS`, and `IMPLEMENTATION_COMPLETED` from action states. Derive due state from open action target dates at read time. Do not represent implementation completion as effectiveness or quality closure.

Force RLS on the sequence, plan, and action tables; use composite tenant foreign keys; constrain runtime privileges; and append security events for plan creation, failed reauthentication, and action completion.

## Consequences

- The investigation-to-action chain is tenant-isolated and cryptographically linked.
- Concurrent requests cannot create duplicate plans or complete an action twice.
- Action scope, assignee, and target date cannot be silently rewritten after planning.
- Progress and overdue state remain consistent without a scheduler or mutable aggregate status.
- Any plan correction, reassignment, extension, or action amendment requires a future explicit controlled procedure rather than direct editing.
- `IMPLEMENTATION_COMPLETED` does not mean effective or closed; those decisions need a later independent workflow.
- Password reauthentication and SHA-256 fingerprints improve attribution and tamper detection but are not complete regulatory electronic signatures or trusted timestamps.

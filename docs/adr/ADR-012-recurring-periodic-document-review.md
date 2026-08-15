# ADR-012: Recurring periodic review of effective documents

## Status

Accepted — 2026-08-15

## Context

Controlled documents need a review cadence after release. The system must make upcoming and overdue work visible, assign responsibility to a qualified person, preserve each conclusion, and behave predictably when the effective version is replaced or withdrawn. A mutable nightly “overdue” job would add operational dependency merely to display elapsed time, while editing one schedule row in place would destroy historical evidence.

## Decision

Store the active policy on `documents` as a paired reviewer and interval from 1 to 60 months. Store every cycle in `document_periodic_reviews`, tied to the effective document version, assigned reviewer, scheduler, and due timestamp.

Allow at most one `PENDING` cycle per tenant document through a partial unique index. Derive `UPCOMING`, `DUE_SOON`, and `OVERDUE` from the due timestamp at read time; the due-soon window is 30 days. A pending cycle can transition once to `COMPLETED` or `CANCELLED`. A PostgreSQL trigger prevents schedule or identity mutation and prevents updates to finalized evidence. The runtime role can select, insert, and perform the one finalizing update, but cannot delete cycles.

The assigned reviewer records either `CONFIRM_EFFECTIVE` or `REVISION_REQUIRED`. Confirmation creates the next cycle from the decision time. Revision-required preserves the policy but creates no pending cycle. Releasing a replacement cancels the prior pending cycle and creates one for the new effective version if the configured reviewer remains active, qualified, and distinct from its author. Obsolescence cancels pending work and removes the active policy.

The API rejects exact-cycle replay through conditional updates and uses tenant predicates, composite foreign keys, and forced RLS for isolation. Security events cover scheduling, rescheduling, confirmation, revision-required conclusions, and cancellation.

## Consequences

- Due visibility does not depend on a background job.
- Every completed or cancelled cycle remains attributable and queryable.
- Configuration follows controlled replacement without rewriting old evidence.
- A newly released version can lose its inherited schedule when the configured reviewer is no longer qualified or becomes that version's author; an authorized user must assign a new reviewer.
- Email reminders, escalations, durable delivery, and notification monitoring require a later worker/outbox phase.
- Server time and production clock controls remain part of the validation and operations boundary.

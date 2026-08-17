# ADR-014: Immutable deviation intake and triage

## Status

Accepted — 2026-08-18

## Context

Quality events need prompt reporting even when severity, impact, and investigation ownership are not yet known. Combining intake and full investigation in one editable record would allow the original observation to drift as later evidence emerges. It would also make concurrent classification ambiguous and encourage premature root-cause or CAPA design before a controlled triage boundary exists.

Users need a stable human-readable reference, but a global counter would reveal cross-tenant activity and create unnecessary contention. Stored overdue flags would also require a scheduler and could become stale.

## Decision

Separate immutable intake fields from a single triage transition in the `deviations` table. A new report starts as `REPORTED` and preserves title, description, area, occurrence time, reporter, tenant, code, and creation time. Permit one conditional transition from `REPORTED` to either `UNDER_INVESTIGATION` or `CANCELLED`. A database trigger freezes intake, identity, and completed transition evidence and rejects any later update.

Allocate `DEV-YYYY-NNNN` codes through a `deviation_sequences` row keyed by tenant and year. Increment and report creation occur in the same tenant-aware transaction. A trigger freezes sequence identity and requires each update to increment exactly once.

Triage requires `deviations.triage`, severity, a future target date, initial impact assessment, containment action, and an active same-tenant investigator. Phase 15 further qualifies new investigators with `deviations.investigate`. Cancellation uses the same elevated triage permission and requires a reason. Both operations use conditional status updates so only one concurrent transition succeeds.

Derive `ON_TRACK`, `DUE_SOON`, and `OVERDUE` from the target timestamp on every read. Apply forced RLS, composite tenant foreign keys, no runtime delete privilege, and security events to both paths. Add new permissions to existing standard system roles in the migration without mutating custom role design.

## Consequences

- The first observation remains distinguishable from subsequent human classification.
- Codes are sequential within each tenant and calendar year without leaking global volume.
- Triage is attributable, tenant-contained, and safe under concurrent requests.
- Due-state display remains current without background mutation.
- Cancellation preserves the report rather than erasing an erroneous or duplicate intake.
- Investigation drafts cannot yet be saved or amended; CAPA, extensions, attachments, broader signatures, and closure require later append-only records and explicit transitions.
- Database owners remain privileged, so operational access control, backups, audit export, retention, and formal validation are still required.

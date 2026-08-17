# ADR-015: Authenticated immutable root-cause investigation

## Status

Accepted — 2026-08-18

## Context

A deviation investigation changes the record from an initial observation and triage hypothesis into a formal conclusion about cause and impact. Allowing that conclusion to remain a mutable set of fields on the deviation would weaken attribution, permit silent rewriting, and make concurrent completion ambiguous. A draft workflow with revision history, collaboration, attachments, and amendments is valuable but would expand this phase into document-like authoring before CAPA and closure boundaries are defined.

The investigation conclusion is a consequential quality action. The current authenticated session alone does not demonstrate that the assigned investigator intentionally finalized the evidence at that moment.

## Decision

Represent only the final investigation conclusion in `deviation_investigations`; do not persist drafts in this phase. Accept one record per tenant and deviation. The record captures the selected root-cause method, problem statement, chronology, immediate cause, root cause, contributing factors, final product/process impact, CAPA assessment and rationale.

Require the assigned investigator to be active and hold `deviations.investigate`. Completion verifies the current password outside the business transaction, then reconfirms the unchanged password hash and active session inside the transaction. Store fixed meaning and authentication-method enums, the completion actor/session/time, and a canonical SHA-256 fingerprint covering intake, triage, investigation, identity, intent, and time.

Insert the investigation before conditionally transitioning the deviation from `UNDER_INVESTIGATION` to `INVESTIGATION_COMPLETED`. A database trigger requires the related investigation row and freezes all intake and triage evidence. A unique tenant/deviation key and transaction rollback make concurrent submissions converge on exactly one completion.

Force RLS and composite tenant foreign keys on the evidence table. Grant the runtime role select and insert only. Add a trigger that rejects update or delete even when a privileged owner issues it. Emit security events for failed reauthentication and successful completion.

## Consequences

- The assigned investigator's formal conclusion is attributable to a password-authenticated active session.
- Root-cause and CAPA assessment evidence cannot be silently rewritten or deleted.
- Queue due state can become `COMPLETED` without a scheduler.
- Users must prepare the complete conclusion before submission because saved drafts, collaboration, and amendments are not yet available.
- CAPA records, closure decisions, extensions, attachments, and investigation amendment procedures require later explicit models and transitions.
- The SHA-256 fingerprint detects changed canonical content but is not a digital signature, trusted timestamp, or complete regulatory electronic-signature control.

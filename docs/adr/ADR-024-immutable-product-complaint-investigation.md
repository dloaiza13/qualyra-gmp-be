# ADR-024: Immutable product complaint intake and independent disposition

- Status: Accepted
- Date: 2026-08-19

## Context

Product quality complaints combine external communications, batch traceability, investigation evidence, regulatory or recall escalation, and a final customer response. Editing the source report or allowing the investigator to approve their own conclusion would weaken the audit trail.

## Decision

Keep the intake immutable after creation. Triage assigns an investigator and a different reviewer. Investigation completion and final disposition are separate password-reauthenticated, session-bound, hashed records. Database constraints and triggers enforce the lifecycle and separation of duties in addition to application permissions. Patient-safety, reporting, and recall flags escalate to specialized processes rather than claiming to implement those processes.

## Consequences

- Corrections require a new traceable record or linked quality record; intake fields are never overwritten.
- Investigation and decision evidence cannot be updated or deleted by the runtime role.
- Tenants must define qualified owners and validated procedures for pharmacovigilance, regulatory reporting, and recall execution.
- Country-specific timelines and outbound authority integrations remain future scope.

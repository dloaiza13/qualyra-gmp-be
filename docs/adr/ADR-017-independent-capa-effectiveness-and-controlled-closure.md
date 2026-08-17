# ADR-017: independent CAPA effectiveness and controlled deviation closure

## Status

Accepted.

## Context

Completing planned CAPA actions proves implementation, not effectiveness. Closing the plan at that point would allow the same person to execute and approve their work and would leave no objective link between the quality decision and the source deviation.

## Decision

Store one tenant-scoped effectiveness review per CAPA after every action is complete. The schedule is immutable and names an observable criterion, target date, scheduler, and active reviewer with `capas.verify_effectiveness`. The reviewer cannot have been assigned to any action in that plan.

The assigned reviewer records `EFFECTIVE` or `INEFFECTIVE` with narrative evidence, password reauthentication, active-session confirmation, attestation, fixed signature meaning, and a SHA-256 fingerprint anchored to the investigation and action fingerprints. An effective decision closes the source deviation in the same database transaction. A database transition guard requires the completed effective review independently of application logic. Ineffective decisions preserve both CAPA and deviation as not closed.

CAPA aggregate state remains derived from action and review evidence rather than stored as a mutable status column.

## Consequences

- Implementation and verification have explicit segregation of duties.
- CAPA and deviation closure cannot diverge after a successful effective decision.
- Review history is immutable, tenant-isolated, attributable, and concurrency-safe.
- Phase 17 initially supports a single review cycle. ADR-018 extends this decision with additive, numbered follow-up cycles rather than mutation of historical evidence.

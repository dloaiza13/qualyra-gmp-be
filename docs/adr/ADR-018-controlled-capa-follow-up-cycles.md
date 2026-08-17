# ADR-018: controlled CAPA follow-up cycles

## Status

Accepted.

## Context

An ineffective verification proves that implemented controls did not achieve their intended result. Reopening the original actions or overwriting the decision would erase the chronology needed to understand what was tried, who verified it, and why more work became necessary.

## Decision

Represent additional treatment as an immutable, tenant-scoped, numbered follow-up cycle sourced from the latest completed `INEFFECTIVE` review. Create the cycle and its actions atomically, then lock its definition. Store one effectiveness review per CAPA and cycle, and expose both the latest review and the complete history.

Keep the action's original due date immutable. Store every approved extension as a separate electronically signed record with its prior effective date, later date, rationale, independent approver, active session, fixed signature meaning, and canonical SHA-256 fingerprint. Serialize extension and completion requests with an action row lock.

Allow action completion to add immutable metadata references to evidence held in a controlled repository. Bind filename, media type, byte size, SHA-256, and repository reference into the completion fingerprint. Do not represent these metadata references as binary upload or managed object storage.

Derive due-soon, overdue, and escalated states from the latest approved due date at read time. Outbound notification delivery is outside this decision.

## Consequences

- Ineffective decisions and earlier action evidence are never reopened or rewritten.
- Each additional treatment and verification remains attributable to a specific cycle.
- Extensions are additive, authenticated, segregated from the assignee, and concurrency-safe.
- Evidence references are verifiable but depend on the organization's controlled repository until managed object storage is added.
- Reminder and escalation labels are visible immediately without mutable scheduler state, but no email or push delivery is implied.

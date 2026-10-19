# Qualyra Continuous Compliance — Phase 2 rule engine

## Outcome

Phase 2 adds deterministic, tenant-configurable evaluation without changing the
purpose of the existing quality workflows. Operational records remain the source
of truth. A rule only interprets one explicit condition and maps it to a
tenant-owned requirement and optional control.

The first supported implementations are:

- `CAPA_ACTION_OVERDUE_V1`: open CAPA actions older than the configured overdue
  threshold.
- `EQUIPMENT_CALIBRATION_OVERDUE_V1`: active, calibration-controlled equipment
  whose next calibration date is older than the configured threshold.

The implementation key selects code that knows how to query an operational
module. The rule record supplies name, severity, category, threshold and
regulatory mapping. Consequently, the evaluator contains no hard-coded ISO,
GMP, FDA or jurisdiction-specific conclusion.

## Execution model

1. An authorized user sends a UUID idempotency key and, optionally, a subset of
   enabled rule IDs.
2. The service creates one tenant-scoped run. A partial unique index prevents
   concurrent `RUNNING` evaluations for the same tenant; runs older than 15
   minutes are marked failed before a new run begins.
3. Each rule runs in its own tenant transaction. A failure in one rule is stored
   as an error result and does not discard successful results from other rules.
4. Each violation receives a SHA-256 fingerprint based on rule ID and stable
   operational subject key.
5. Findings are reconciled rather than duplicated:
   - a new fingerprint creates an open finding;
   - an active match is refreshed;
   - a resolved match is reopened if the condition recurs;
   - an accepted risk remains accepted;
   - an open/in-progress fingerprint absent from the next successful rule result
     is resolved automatically.
6. The run stores scanned records, violations and finding lifecycle totals.
   Security events preserve the actor, request context and outcome.

Rule result details are capped at 100 violations to keep history bounded. The
aggregate counts remain complete.

## Tenant isolation and integrity

`ComplianceRule`, `ComplianceEvaluationRun` and `ComplianceRuleResult` use
composite tenant foreign keys, forced PostgreSQL RLS and the existing
`TenantUnitOfWork`. Runtime roles cannot delete immutable rule results. Generated
findings preserve source type, source UUID, visible reference, rule, fingerprint
and last evaluation.

## API

- `GET /compliance/rule-catalog`
- `GET|POST /compliance/rules`
- `PATCH /compliance/rules/:ruleId`
- `GET /compliance/evaluations`
- `GET /compliance/evaluations/:evaluationId`
- `POST /compliance/evaluations`

Read endpoints require `compliance.read`, rule mutations require
`compliance.manage`, and execution requires `compliance.evaluate`.

## Deliberately deferred

- Scheduling/background queues and additional operational adapters belong to
  Phase 4.
- Readiness scoring, explanations, snapshots and trends belong to Phase 3.
- An LLM does not decide pass/fail and is not part of this engine.

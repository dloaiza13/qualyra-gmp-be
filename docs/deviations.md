# GMP deviations

Phase 14 adds tenant-isolated reporting and triage for quality deviations. The scope ends when a reported event is assigned for investigation; root-cause analysis, CAPA linkage, effectiveness checks, and controlled closure remain deferred.

## Permissions

| Permission          | Capability                                                |
| ------------------- | --------------------------------------------------------- |
| `deviations.read`   | List and read deviations in the authenticated tenant      |
| `deviations.create` | Report a quality deviation                                |
| `deviations.triage` | Classify, assign, contain, or cancel a reported deviation |

Administrators receive every permission. Default QA Managers can read, report, and triage. Document Controllers and Operators can read and report. Auditors have read-only access. The migration adds these grants to existing standard system roles without changing custom roles or replacing existing grants.

An investigator must be an active user in the same tenant and hold `deviations.read`. Frontend visibility is not an authorization control; every route verifies the authenticated tenant and permission at the API.

## API

All routes use the `/api/v1` prefix.

| Method | Route                             | Permission          | Purpose                                      |
| ------ | --------------------------------- | ------------------- | -------------------------------------------- |
| `GET`  | `/deviations`                     | `deviations.read`   | List summaries with optional filters         |
| `GET`  | `/deviations/:deviationId`        | `deviations.read`   | Read the original report and triage evidence |
| `POST` | `/deviations`                     | `deviations.create` | Report a quality event                       |
| `POST` | `/deviations/:deviationId/triage` | `deviations.triage` | Classify and assign an investigation         |
| `POST` | `/deviations/:deviationId/cancel` | `deviations.triage` | Cancel an untriaged report with a reason     |

The list accepts `status`, `severity`, `search`, and `limit` filters. Search matches the code, title, or area. Summary responses intentionally omit the narrative description, impact assessment, containment action, and transition actors.

## Reporting and human-readable codes

A report records the objective title, description, affected area or process, occurrence time, reporter, and server timestamp. Occurrence time cannot be in the future. The initial status is `REPORTED`, with no severity or investigator until triage.

Each tenant receives an independent annual sequence formatted as `DEV-YYYY-NNNN`. The `deviation_sequences` row is incremented inside the same tenant-aware database transaction as the report, so concurrent requests cannot issue duplicate codes. A database trigger permits only a one-step increment and freezes the sequence identity.

## Triage and cancellation

A reported deviation has two allowed transitions:

- `REPORTED` to `UNDER_INVESTIGATION`, with severity, active qualified investigator, future target date, initial impact assessment, containment action, triage actor, and timestamp.
- `REPORTED` to `CANCELLED`, with cancellation actor, timestamp, and reason.

Severity is `MINOR`, `MAJOR`, or `CRITICAL`. The investigation due state is derived at read time: `OVERDUE` after the target, `DUE_SOON` during the preceding seven days, and otherwise `ON_TRACK`. A report without an investigation target is `NOT_APPLICABLE`; no scheduler mutates rows merely because time passes.

Conditional updates ensure that only one concurrent transition succeeds. A PostgreSQL trigger freezes the original report, identity fields, and terminal transition evidence. It rejects edits to an already-triaged or cancelled record. The runtime role cannot delete deviations or sequence rows.

## Isolation and evidence

Both tables use forced PostgreSQL row-level security and transaction-local tenant context. Composite tenant foreign keys prevent assigning a reporter, investigator, triage actor, or cancellation actor from another tenant. Successful reports, triage decisions, and cancellations append `DEVIATION_REPORTED`, `DEVIATION_TRIAGED`, and `DEVIATION_CANCELLED` security events with correlation and request metadata.

## Deferred scope

Root-cause methods, investigation notes and attachments, disposition, CAPA creation and linkage, extension approval, effectiveness checks, electronic signatures, closure approval, reminders, escalation, exports, and trend analytics are deferred. Organizations must operate investigation follow-up and due-date escalation procedurally until those controls are implemented and validated.

These controls are audit-ready building blocks and do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

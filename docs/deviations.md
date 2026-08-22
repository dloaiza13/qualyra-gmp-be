# GMP deviations

Phases 14 and 15 add tenant-isolated reporting, triage, and authenticated root-cause investigation for quality deviations. Phases 16 through 18 consume investigations requiring CAPA through the separately controlled [CAPA workflow](capa.md), preserve ineffective verification cycles, and close the deviation only when the latest review is effective.

## Permissions

| Permission               | Capability                                                |
| ------------------------ | --------------------------------------------------------- |
| `deviations.read`        | List and read deviations in the authenticated tenant      |
| `deviations.create`      | Report a quality deviation                                |
| `deviations.triage`      | Classify, assign, contain, or cancel a reported deviation |
| `deviations.investigate` | Complete an investigation assigned to the caller          |

Administrators receive every permission. Default QA Managers can read every record, report, triage, and investigate. Operators can report and read their own deviations. Auditors have organization-wide read-only access. Document Controllers do not receive this module by default. See `access-control-matrix.md` for the complete role model.

An investigator must be an active user in the same tenant and hold `deviations.investigate`. Only that assigned person may complete the investigation. Frontend visibility is not an authorization control; every route verifies the authenticated tenant and permission at the API.

## API

All routes use the `/api/v1` prefix.

| Method | Route                                             | Permission               | Purpose                                                      |
| ------ | ------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| `GET`  | `/deviations`                                     | `deviations.read`        | List summaries with optional filters                         |
| `GET`  | `/deviations/:deviationId`                        | `deviations.read`        | Read intake, triage, and final investigation evidence        |
| `POST` | `/deviations`                                     | `deviations.create`      | Report a quality event                                       |
| `POST` | `/deviations/:deviationId/triage`                 | `deviations.triage`      | Classify and assign an investigation                         |
| `POST` | `/deviations/:deviationId/cancel`                 | `deviations.triage`      | Cancel an untriaged report with a reason                     |
| `POST` | `/deviations/:deviationId/investigation/complete` | `deviations.investigate` | Reauthenticate and complete the assigned root-cause analysis |

The list accepts `status`, `severity`, `search`, and `limit` filters. Search matches the code, title, or area. Summary responses intentionally omit the narrative description, triage narratives, root-cause evidence, and transition actors. They expose only the CAPA decision and investigation completion timestamp needed for queue states.

## Reporting and human-readable codes

A report records the objective title, description, affected area or process, occurrence time, reporter, and server timestamp. Occurrence time cannot be in the future. The initial status is `REPORTED`, with no severity or investigator until triage.

Each tenant receives an independent annual sequence formatted as `DEV-YYYY-NNNN`. The `deviation_sequences` row is incremented inside the same tenant-aware database transaction as the report, so concurrent requests cannot issue duplicate codes. A database trigger permits only a one-step increment and freezes the sequence identity.

## Triage and cancellation

A reported deviation has two allowed transitions:

- `REPORTED` to `UNDER_INVESTIGATION`, with severity, active qualified investigator, future target date, initial impact assessment, containment action, triage actor, and timestamp.
- `REPORTED` to `CANCELLED`, with cancellation actor, timestamp, and reason.

Severity is `MINOR`, `MAJOR`, or `CRITICAL`. The investigation due state is derived at read time: `OVERDUE` after the target, `DUE_SOON` during the preceding seven days, and otherwise `ON_TRACK`. A report without an investigation target is `NOT_APPLICABLE`; no scheduler mutates rows merely because time passes.

Conditional updates ensure that only one concurrent transition succeeds. A PostgreSQL trigger freezes the original report and completed triage evidence. It rejects edits to a completed or cancelled record. The runtime role cannot delete deviations or sequence rows.

## Root-cause investigation

An assigned investigator with `deviations.investigate` can complete an `UNDER_INVESTIGATION` deviation using `FIVE_WHYS`, `ISHIKAWA`, `FAULT_TREE_ANALYSIS`, or `OTHER`. Completion requires a problem statement, chronology, immediate cause, confirmed root cause, contributing factors, final product/process impact, CAPA requirement, and rationale.

Completion reauthenticates the investigator's current password, reconfirms an active session and unchanged password hash, and requires explicit attestation. The API creates one immutable `deviation_investigations` row, stores the fixed meaning `INVESTIGATION_COMPLETION`, authentication method `PASSWORD_REAUTHENTICATION`, actor, session, timestamp, and a canonical SHA-256 record fingerprint. The deviation then transitions atomically from `UNDER_INVESTIGATION` to `INVESTIGATION_COMPLETED`.

A unique tenant/deviation constraint and conditional status transition ensure that only one concurrent completion succeeds. The database requires investigation evidence before accepting the status transition. The evidence table rejects update and delete even for the table owner, while the runtime role receives only select and insert privileges. Completed due state is `COMPLETED` rather than a time-derived overdue state.

## Controlled closure

A deviation requiring CAPA remains `INVESTIGATION_COMPLETED` throughout action execution and effectiveness scheduling. It can transition to `CLOSED` only in the same transaction that completes its independent CAPA review as `EFFECTIVE`. The detail response exposes the CAPA code, reviewer, closure time, and effectiveness record fingerprint. `CLOSED` is terminal and all intake, triage, and investigation evidence remains immutable.

## Isolation and evidence

All three tables use forced PostgreSQL row-level security and transaction-local tenant context. Composite tenant foreign keys prevent assigning a reporter, investigator, triage actor, cancellation actor, completion actor, or session from another tenant. Successful reports, triage decisions, cancellations, failed investigation reauthentication, and investigation completion append security events with correlation and request metadata.

## Deferred scope

Investigation drafts and amendments, attachments, disposition, extension approval, follow-up action cycles for ineffective CAPA, broader electronic-signature controls, reminders, escalation, exports, and trend analytics are deferred. Organizations must operate those follow-up and due-date escalation controls procedurally until they are implemented and validated.

These controls are audit-ready building blocks and do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

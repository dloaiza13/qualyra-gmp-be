# Corrective and preventive actions (CAPA)

Phases 16 and 17 turn a completed deviation investigation into a controlled CAPA plan and carry it through independent effectiveness verification. They cover immutable planning, assigned corrective and preventive actions, authenticated implementation evidence, an independent quality decision, CAPA closure, and atomic closure of the source deviation when the result is effective.

## Permissions

| Permission                     | Capability                                               |
| ------------------------------ | -------------------------------------------------------- |
| `capas.read`                   | List plans and read their source and action evidence     |
| `capas.create`                 | Create a plan from an eligible completed investigation   |
| `capas.execute`                | Complete an action assigned to the authenticated caller  |
| `capas.schedule_effectiveness` | Schedule an independent review after implementation      |
| `capas.verify_effectiveness`   | Complete the assigned review with authenticated evidence |

Administrators and default QA Managers receive every CAPA permission. Document Controllers and Operators can read plans and execute assigned actions. Auditors have read-only access. Existing standard roles receive additive grants in the migration; custom roles are not changed.

An action assignee must be active in the same tenant and hold `capas.execute`. UI visibility does not authorize an action: the API verifies tenant, permission, assignment, active session, and current password.

## API

All routes use the `/api/v1` prefix.

| Method | Route                                          | Permission                     | Purpose                                           |
| ------ | ---------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| `GET`  | `/capas`                                       | `capas.read`                   | List safe plan summaries with optional search     |
| `GET`  | `/capas/:capaId`                               | `capas.read`                   | Read source investigation and action evidence     |
| `POST` | `/capas`                                       | `capas.create`                 | Create and lock a plan and its actions atomically |
| `POST` | `/capas/:capaId/actions/:actionId/complete`    | `capas.execute`                | Authenticate completion of one assigned action    |
| `POST` | `/capas/:capaId/effectiveness-review`          | `capas.schedule_effectiveness` | Schedule the independent review                   |
| `POST` | `/capas/:capaId/effectiveness-review/complete` | `capas.verify_effectiveness`   | Authenticate the assigned reviewer's decision     |

Search matches CAPA code/title and source deviation code/title. List responses expose progress counts and the next open due date but omit root cause, action narratives, completion comments, and record hashes.

## Eligibility and planning

A CAPA can be created only when its source deviation is `INVESTIGATION_COMPLETED`, the related immutable investigation has `requiresCapa = true`, and no other CAPA exists for that deviation or investigation. The plan records a title, objective, creator, and between one and fifty typed actions. Each action is `CORRECTIVE` or `PREVENTIVE` and has an immutable title, implementation description, active qualified assignee, and future target date.

Each tenant receives an independent annual number formatted as `CAPA-YYYY-NNNN`. The sequence, plan, and actions are created in one tenant-aware transaction. The service then performs the only permitted plan update: setting an internal lock after at least one action exists. PostgreSQL triggers reject source mismatch, a plan without actions, later plan edits or deletion, action insertion after locking, and changes to action identity or assignment. Unique tenant/source constraints and conditional writes make concurrent plan creation converge on one result.

## Execution and evidence

An open action may transition exactly once to `COMPLETED`, and only by its assigned user. Completion requires an implementation comment, current password, and explicit attestation. The service verifies the password, then reconfirms the unchanged password hash and active session inside the transaction.

The completed row stores fixed meaning `ACTION_COMPLETION`, authentication method `PASSWORD_REAUTHENTICATION`, session, comment, timestamp, and a canonical SHA-256 fingerprint. The fingerprint covers the source investigation hash, plan, action definition, assignee, authenticated actor, session, intent, comment, and completion time. Database checks require either a fully open state or complete evidence; triggers reject subsequent mutation or deletion. Failed reauthentication and successful completion append security events.

## Effectiveness and controlled closure

An effectiveness review can be scheduled only after every plan action is complete. It records an immutable observable criterion, future target date, scheduler, and assigned reviewer. The reviewer must be active, hold `capas.verify_effectiveness`, and must not be the assignee of any action in that CAPA. This segregation is enforced by both the service and a database insertion guard.

Only the assigned reviewer can complete the review. Completion requires a current password, active unchanged session, explicit attestation, a decision of `EFFECTIVE` or `INEFFECTIVE`, and narrative evidence. The immutable SHA-256 fingerprint anchors the decision to the investigation fingerprint and every action fingerprint. Concurrent attempts converge on one completion.

An `EFFECTIVE` decision changes the source deviation from `INVESTIGATION_COMPLETED` to `CLOSED` in the same transaction. PostgreSQL independently rejects that transition unless a completed effective review exists. An `INEFFECTIVE` decision preserves the evidence but leaves the deviation open for additional treatment.

## Derived status and due state

Plan status is derived from immutable actions rather than stored as mutable workflow state:

- `OPEN` when no action is complete;
- `IN_PROGRESS` when some actions are complete;
- `IMPLEMENTATION_COMPLETED` when every action is complete.
- `EFFECTIVENESS_REVIEW` while the independent review is scheduled;
- `CLOSED_EFFECTIVE` after an effective authenticated decision;
- `INEFFECTIVE` after an ineffective authenticated decision.

Open action dates produce `OVERDUE`, `DUE_SOON` during the preceding seven days, or `ON_TRACK`. A completed action and a fully implemented plan return `COMPLETED`. No scheduler rewrites records as time passes.

## Isolation and deferred scope

`capa_sequences`, `capas`, `capa_actions`, and `capa_effectiveness_reviews` use forced PostgreSQL row-level security. Composite tenant foreign keys prevent cross-tenant source, creator, assignee, reviewer, and session references. The runtime role cannot delete any CAPA record, and database transition guards constrain its necessary update grants.

Follow-up action cycles after an ineffective decision, plan amendments, reassignment, extensions, attachments, notifications, exports, and trend analysis require later explicit workflows. These controls are audit-ready building blocks and do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

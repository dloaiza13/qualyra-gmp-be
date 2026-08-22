# Corrective and preventive actions (CAPA)

Phases 16 through 20 turn a completed deviation investigation into a controlled CAPA plan and carry it through repeatable independent effectiveness verification. They cover immutable planning, managed binary evidence, authenticated implementation, extensions, ineffective-result follow-up cycles, automated deadline monitoring, aggregate trends, independent quality decisions, atomic closure of the source deviation, S3-compatible custody, external malware scanning, retention, and attributable audit exports.

## Permissions

| Permission                     | Capability                                                 |
| ------------------------------ | ---------------------------------------------------------- |
| `capas.read`                   | List plans and read their source and action evidence       |
| `capas.create`                 | Create a plan from an eligible completed investigation     |
| `capas.execute`                | Complete an action assigned to the authenticated caller    |
| `capas.schedule_effectiveness` | Schedule an independent review after implementation        |
| `capas.verify_effectiveness`   | Complete the assigned review with authenticated evidence   |
| `capas.create_follow_up`       | Create a numbered action cycle after an ineffective result |
| `capas.approve_extensions`     | Approve action due-date extensions with reauthentication   |
| `capas.export`                 | Generate an immutable, hashed CAPA audit manifest          |

Administrators and default QA Managers receive every CAPA permission. Document Controllers and Operators can read and execute plans assigned to them. Auditors can read every plan and export audit evidence, but cannot operate it. Assignment selectors do not require access to tenant administration. See `access-control-matrix.md` for the complete role model.

An action assignee must be active in the same tenant and hold `capas.execute`. UI visibility does not authorize an action: the API verifies tenant, permission, assignment, active session, and current password.

## API

All routes use the `/api/v1` prefix.

| Method | Route                                          | Permission                     | Purpose                                             |
| ------ | ---------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| `GET`  | `/capas`                                       | `capas.read`                   | List safe plan summaries with optional search       |
| `GET`  | `/capas/:capaId`                               | `capas.read`                   | Read source investigation and action evidence       |
| `POST` | `/capas`                                       | `capas.create`                 | Create and lock a plan and its actions atomically   |
| `POST` | `/capas/:capaId/actions/:actionId/complete`    | `capas.execute`                | Authenticate completion of one assigned action      |
| `POST` | `/capas/:capaId/effectiveness-review`          | `capas.schedule_effectiveness` | Schedule the independent review                     |
| `POST` | `/capas/:capaId/effectiveness-review/complete` | `capas.verify_effectiveness`   | Authenticate the assigned reviewer's decision       |
| `POST` | `/capas/:capaId/follow-up-cycles`              | `capas.create_follow_up`       | Create and lock the next numbered action cycle      |
| `POST` | `/capas/:capaId/actions/:actionId/extensions`  | `capas.approve_extensions`     | Authenticate an immutable due-date extension        |
| `GET`  | `/capas/analytics`                             | `capas.read`                   | Read derived tenant CAPA trends and monitor history |
| `POST` | `/capas/:capaId/actions/:actionId/evidence`    | `capas.execute`                | Analyze and stage one managed evidence file         |
| `GET`  | `/capas/:capaId/evidence/:evidenceId/download` | `capas.read`                   | Download one authorized verified evidence file      |
| `POST` | `/capas/:capaId/audit-exports`                 | `capas.export`                 | Create and return an immutable audit manifest       |

Search matches CAPA code/title and source deviation code/title. List responses expose progress counts and the next open due date but omit root cause, action narratives, completion comments, and record hashes.

## Eligibility and planning

A CAPA can be created only when its source deviation is `INVESTIGATION_COMPLETED`, the related immutable investigation has `requiresCapa = true`, and no other CAPA exists for that deviation or investigation. The plan records a title, objective, creator, and between one and fifty typed actions. Each action is `CORRECTIVE` or `PREVENTIVE` and has an immutable title, implementation description, active qualified assignee, and future target date.

Each tenant receives an independent annual number formatted as `CAPA-YYYY-NNNN`. The sequence, plan, and actions are created in one tenant-aware transaction. The service then performs the only permitted plan update: setting an internal lock after at least one action exists. PostgreSQL triggers reject source mismatch, a plan without actions, later plan edits or deletion, action insertion after locking, and changes to action identity or assignment. Unique tenant/source constraints and conditional writes make concurrent plan creation converge on one result.

## Execution and evidence

An open action may transition exactly once to `COMPLETED`, and only by its assigned user. Completion requires an implementation comment, current password, and explicit attestation. The service verifies the password, then reconfirms the unchanged password hash and active session inside the transaction.

The completed row stores fixed meaning `ACTION_COMPLETION`, authentication method `PASSWORD_REAUTHENTICATION`, session, comment, timestamp, and a canonical SHA-256 fingerprint. Completion can atomically add up to ten immutable evidence references: filename, content type, byte size, SHA-256, and either an external controlled-repository reference or a Qualyra-managed upload.

A managed upload is limited to the configured size and to PDF, PNG, JPEG, or UTF-8 text. Qualyra validates the claimed type against file signatures, rejects executable and known test-malware signatures, computes SHA-256, uses an opaque object key, and isolates metadata with tenant RLS. Only the assigned user can upload to an open action. Storage is selected through a port: local disk is the lightweight development default, while the S3 adapter supports AWS S3 and path-style compatible services such as MinIO. Production configuration requires S3-compatible storage over HTTPS.

The scanner is independently selectable. The built-in type/signature scanner always runs; the ClamAV adapter then sends the stream through `clamd` using `INSTREAM`. Timeout, connection failure, empty response, or malformed response denies the upload. Production configuration requires the external scanner. The Compose profile binds `clamd` to loopback because that protocol has no application authentication or transport encryption.

A safe staged upload expires after the configured interval and can be consumed once. Completion binds it to the signed fingerprint in the same transaction. The retention worker atomically claims expired, unconsumed uploads as `PURGING`, deletes the object idempotently, and records `EXPIRED` plus `purgedAt`. A consumed upload cannot enter the purge lifecycle. Authorized downloads reverify SHA-256 and are returned as non-cacheable attachments.

The fingerprint covers the source investigation hash, plan, action definition, approved extension fingerprints, evidence-reference metadata, authenticated actor, session, intent, comment, and completion time. Database checks require either a fully open state or complete evidence; triggers reject subsequent mutation or deletion.

An open action can receive one or more extensions. The original target date is never edited. Each extension stores the previous effective date, later approved date, rationale, approver-bound active session, fixed meaning `ACTION_EXTENSION_APPROVAL`, password reauthentication, approval time, and SHA-256 fingerprint. The approver cannot be the action assignee. Row locking serializes extension and completion requests so completion cannot omit a concurrently approved extension.

## Effectiveness and controlled closure

An effectiveness review can be scheduled only after every action in the current cycle is complete. It records the cycle number, immutable observable criterion, future target date, scheduler, and assigned reviewer. The reviewer must be active, hold `capas.verify_effectiveness`, and must not be the assignee of any action across the CAPA. This segregation is enforced by both the service and a database insertion guard.

Only the assigned reviewer can complete the review. Completion requires a current password, active unchanged session, explicit attestation, a decision of `EFFECTIVE` or `INEFFECTIVE`, and narrative evidence. The immutable SHA-256 fingerprint anchors the decision to the investigation fingerprint and every action fingerprint. Concurrent attempts converge on one completion.

An `EFFECTIVE` decision changes the source deviation from `INVESTIGATION_COMPLETED` to `CLOSED` in the same transaction. PostgreSQL independently rejects that transition unless a completed effective review exists. An `INEFFECTIVE` decision preserves the evidence and leaves the deviation open.

After an ineffective result, an authorized quality user can create exactly one next cycle from that review. The cycle rationale and one to fifty new actions are created and locked atomically. Original actions, earlier cycle actions, and every review remain unchanged. Once the current cycle actions are complete, a new review is scheduled with the matching cycle number. Unique constraints, conditional writes, and insertion guards prevent skipped, duplicated, or branched cycles.

## Derived status and due state

Plan status is derived from immutable actions rather than stored as mutable workflow state:

- `OPEN` when no action is complete;
- `IN_PROGRESS` when some actions are complete;
- `IMPLEMENTATION_COMPLETED` when every action is complete.
- `FOLLOW_UP_ACTIONS` while the current follow-up cycle has open actions;
- `FOLLOW_UP_IMPLEMENTATION_COMPLETED` when its actions are complete and its review is not yet scheduled;
- `EFFECTIVENESS_REVIEW` while the independent review is scheduled;
- `CLOSED_EFFECTIVE` after an effective authenticated decision;
- `INEFFECTIVE` after an ineffective authenticated decision.

The latest approved extension supplies the effective due date without replacing the original. Open actions and scheduled effectiveness reviews produce `DUE_SOON` during the preceding seven days, `OVERDUE` during the first seven overdue days, `ESCALATED` after seven overdue days, or `ON_TRACK` otherwise.

The application monitor evaluates active tenants on a configurable interval. It creates the CAPA notification and encrypted outbox intent atomically, deduplicated by recipient, deadline, and state transition. Assignees receive due and overdue messages; escalated items also reach active quality users. The shared outbox worker delivers only after commit, recovers abandoned leases, and uses bounded configurable retries. SMTP delivery is at-least-once rather than exactly-once.

`GET /capas/analytics` derives effectiveness rate, late work, status/severity distribution, assignee workload, and recent notification evidence directly from tenant source records. It does not maintain a separate mutable reporting aggregate.

## Audit exports

`POST /capas/:capaId/audit-exports` captures the source deviation and investigation, action definitions and completion fingerprints, extensions, evidence metadata and scan results, every effectiveness review, follow-up cycle, and notification delivery record in one tenant transaction. The JSON manifest identifies the exporter and generation time, uses a versioned schema, and includes a SHA-256 computed over a deterministic canonical representation that excludes only the integrity block itself.

The exact returned manifest is stored in `capa_audit_exports`. PostgreSQL RLS isolates it by tenant, and trigger plus runtime grants reject update or deletion. A corresponding security event records the export id and fingerprint. The manifest references evidence binaries by immutable metadata and hash; it does not embed the binaries.

## Isolation and deferred scope

Every CAPA table, including follow-up cycles, extensions, evidence uploads, references, notifications, and audit exports, uses forced PostgreSQL row-level security. Composite tenant foreign keys prevent cross-tenant source, creator, assignee, reviewer, approver, recipient, exporter, and session references. The runtime role cannot delete CAPA evidence or mutate exports, and database transition guards constrain its necessary update grants.

Production still requires managed object-store encryption at rest, private network controls, retention-policy approval, malware-signature monitoring, backup/restore validation, plan amendments, reassignment, and validated statistical process control. These controls are audit-ready building blocks and do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

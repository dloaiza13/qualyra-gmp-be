# GMP audits and inspections

The audits module preserves a tenant-scoped inspection lifecycle from an approved plan through findings, authenticated responses, independent review, and signed closure.

## Permissions

| Permission       | Capability                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `audits.read`    | Read audit plans, findings, response history, and signed records |
| `audits.plan`    | Plan or cancel an audit and assign qualified participants        |
| `audits.execute` | Start an assigned audit, record findings, and sign its report    |
| `audits.respond` | Sign responses to assigned findings                              |
| `audits.review`  | Accept a response or request a new immutable attempt             |
| `audits.close`   | Sign independent closure after every finding is accepted         |

Administrators and default QA Managers receive all permissions. Auditors can plan, execute, and review. Operators and Document Controllers can read and respond. Existing standard roles receive additive grants; custom roles are unchanged.

## API

| Method | Route                                                               | Permission       | Purpose                               |
| ------ | ------------------------------------------------------------------- | ---------------- | ------------------------------------- |
| `GET`  | `/audits`                                                           | `audits.read`    | List filtered tenant summaries        |
| `GET`  | `/audits/participants`                                              | `audits.plan`    | List active qualified participants    |
| `GET`  | `/audits/:auditId`                                                  | `audits.read`    | Read the complete evidence chain      |
| `POST` | `/audits`                                                           | `audits.plan`    | Preserve an immutable audit plan      |
| `POST` | `/audits/:auditId/start`                                            | `audits.execute` | Start the assigned execution          |
| `POST` | `/audits/:auditId/findings`                                         | `audits.execute` | Record an immutable finding           |
| `POST` | `/audits/:auditId/report`                                           | `audits.execute` | Sign the execution report             |
| `POST` | `/audits/:auditId/findings/:findingId/responses`                    | `audits.respond` | Sign a new response attempt           |
| `POST` | `/audits/:auditId/findings/:findingId/responses/:responseId/review` | `audits.review`  | Sign an independent response review   |
| `POST` | `/audits/:auditId/closure`                                          | `audits.close`   | Sign final independent closure        |
| `POST` | `/audits/:auditId/cancel`                                           | `audits.plan`    | Cancel a plan while retaining history |

The list supports `status`, `search`, and `limit`. Each tenant receives an annual `AUD-YYYY-NNNN` sequence, while findings receive stable `AUD-YYYY-NNNN-FNN` codes.

## Lifecycle and evidence

The lead auditor and closure reviewer must be different active users with the required permissions. Only the lead can start execution, add findings, and complete the report. Findings preserve classification, requirement reference, objective evidence, responsible user, and response deadline.

Report completion, each response attempt, every review, and final closure require the current password, explicit attestation, an active unexpired session, and a stable password hash through commit. Each signed record includes its fixed meaning, authentication method, timestamp, actor-bound session, and deterministic SHA-256 fingerprint.

A rejected response is never overwritten: `REQUEST_REVISION` reopens the finding and the responsible user submits a numbered new attempt. `ACCEPT` closes the finding. The audit becomes `READY_FOR_CLOSURE` only after all findings are closed. Optional CAPA and change-control references are validated against the current tenant.

## Database enforcement

All six audit tables use forced PostgreSQL row-level security and composite tenant foreign keys. Database triggers reject plan edits, invalid lifecycle transitions, unauthorized finding/report inserts, skipped response attempts, repeat reviews, and update/delete of signed report or closure records. The runtime database role cannot delete lifecycle data.

These controls are audit-ready building blocks and do not by themselves establish GMP, ISO, FDA, or 21 CFR Part 11 compliance. Validated deployment, identity governance, trusted time, retention, procedures, and intended-use assessment remain organization responsibilities.

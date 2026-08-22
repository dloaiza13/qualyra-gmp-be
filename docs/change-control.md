# GMP change control

The change-control module governs planned changes from proposal through independent effectiveness verification. It preserves the original request, impact and risk assessment, approval decision, implementation task evidence, and final verification as tenant-isolated records.

## Permissions

| Permission          | Capability                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `changes.read`      | Read change-control summaries and evidence in the current tenant   |
| `changes.create`    | Propose a planned GMP change                                       |
| `changes.assess`    | Assess impact/risk, assign independent actors, and cancel requests |
| `changes.approve`   | Sign the assigned approval or rejection decision                   |
| `changes.implement` | Sign completion of assigned implementation tasks                   |
| `changes.verify`    | Sign the assigned independent effectiveness verification           |

Administrators and default QA Managers receive all six permissions. Document Controllers and Operators can propose changes and read or implement records assigned to them. Auditors receive organization-wide read-only access. See `access-control-matrix.md` for the complete role model.

## API

| Method | Route                                                      | Permission          | Purpose                                      |
| ------ | ---------------------------------------------------------- | ------------------- | -------------------------------------------- |
| `GET`  | `/change-controls`                                         | `changes.read`      | List filtered tenant summaries               |
| `GET`  | `/change-controls/participants`                            | `changes.assess`    | List active qualified workflow participants  |
| `GET`  | `/change-controls/:changeControlId`                        | `changes.read`      | Read the complete evidence chain             |
| `POST` | `/change-controls`                                         | `changes.create`    | Preserve a new proposal                      |
| `POST` | `/change-controls/:changeControlId/assessment`             | `changes.assess`    | Preserve assessment and implementation plan  |
| `POST` | `/change-controls/:changeControlId/cancel`                 | `changes.assess`    | Cancel an unevaluated proposal with a reason |
| `POST` | `/change-controls/:changeControlId/decision`               | `changes.approve`   | Sign approval or rejection                   |
| `POST` | `/change-controls/:changeControlId/tasks/:taskId/complete` | `changes.implement` | Sign assigned task completion                |
| `POST` | `/change-controls/:changeControlId/verification`           | `changes.verify`    | Sign effectiveness and close the lifecycle   |

The list accepts `status`, `search`, and `limit`. Search matches the code, title, or proposal description. Summary responses expose only queue metadata, risk level, target date, and task counts; detailed narratives and fingerprints remain in the detail endpoint.

## Lifecycle and segregation

Each tenant receives an independent annual sequence `CC-YYYY-NNNN`. Proposal title, description, justification, category, proposer, target date, and creation time become immutable immediately.

An assessment can be recorded only while the change is `PROPOSED` and only by someone other than the proposer. It captures quality, regulatory, validation, training, and document impact; risk and rationale; implementation and rollback plans; an observable verification criterion; qualified owner, approver, verifier; and one to twenty-five assigned tasks.

The proposer, assessor, approver, and verifier must be distinct. The owner cannot be the verifier, and the verifier cannot execute any implementation task. Participants must be active in the same tenant and possess their required permission. Both the service and PostgreSQL insertion guards enforce these rules.

The assigned approver reauthenticates and signs either `APPROVE` or `REJECT`. An approved change moves through `APPROVED` and `IMPLEMENTING`; the final signed task completion moves it atomically to `PENDING_VERIFICATION`. The assigned independent verifier then reauthenticates and records objective evidence. `EFFECTIVE` closes the change; `INEFFECTIVE` ends it as `VERIFICATION_FAILED`, retaining the full evidence chain for follow-up governance.

## Signed evidence and concurrency

Approval, task completion, and verification require the current password, explicit attestation, an active unexpired session, and an unchanged password hash between verification and commit. Each record stores the actor, session, timestamp, fixed signature meaning, authentication method, and a deterministic SHA-256 fingerprint. Reauthentication failures and successful transitions append tenant-scoped security events.

Conditional updates and unique tenant/change constraints ensure one valid transition wins under concurrent requests. Database triggers independently reject invalid status changes, proposal edits, repeated task completion, unsigned transitions, and update/delete of assessment, decision, or verification evidence.

## Tenant isolation

All six change-control tables use forced PostgreSQL row-level security. Composite foreign keys prevent cross-tenant proposer, participant, task, and session references. The runtime role cannot delete any lifecycle record and cannot update append-only assessment or signature evidence.

This implementation provides audit-ready controls but does not by itself claim regulatory compliance. Validated deployment, identity policy, trusted time, retention, signed-record manifestation, procedural review, and formal intended-use assessment remain organization responsibilities.

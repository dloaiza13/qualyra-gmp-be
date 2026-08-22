# Document training

Phase 13 adds version-bound reading assignments for effective controlled documents. It records authenticated acknowledgement evidence without claiming that the participant demonstrated competence.

## Permissions

| Permission          | Capability                                                                  |
| ------------------- | --------------------------------------------------------------------------- |
| `training.read`     | Read the caller's assignments and an assignment the caller may access       |
| `training.assign`   | List tenant assignments, create assignments, and cancel pending assignments |
| `training.complete` | Complete an assignment addressed to the authenticated user                  |

Administrators and default QA Managers can read, assign, and complete training. Document Controllers can also manage assignments and complete their own training. Operators and Auditors can read and complete only their own assignments. The service verifies permissions, tenant identity, user status, and assignment ownership; frontend visibility is not an authorization control.

## API

All routes use the `/api/v1` prefix.

| Method | Route                                          | Permission          | Purpose                                       |
| ------ | ---------------------------------------------- | ------------------- | --------------------------------------------- |
| `GET`  | `/training/assignments/my`                     | `training.read`     | List assignments addressed to the caller      |
| `GET`  | `/training/assignments`                        | `training.assign`   | List assignments across the current tenant    |
| `GET`  | `/training/assignments/:assignmentId`          | `training.read`     | Read exact assigned content and evidence      |
| `POST` | `/training/assignments`                        | `training.assign`   | Assign an effective version to active users   |
| `POST` | `/training/assignments/:assignmentId/complete` | `training.complete` | Reauthenticate and acknowledge the assignment |
| `POST` | `/training/assignments/:assignmentId/cancel`   | `training.assign`   | Cancel a pending assignment with a reason     |

The detail route returns content only to the assigned user or to a caller that also has `training.assign`. List responses omit document content.

## Assignment rules

An assignment targets the exact version that is effective when it is created. The due timestamp must be in the future, every participant must be an active user in the authenticated tenant, and every participant must hold `training.complete`. A partial unique index permits at most one `ASSIGNED` row for the same tenant, version, and participant. Completed or cancelled history does not prevent a later reassignment.

Due state is derived at read time. Pending work is `OVERDUE` after its due timestamp, `DUE_SOON` during the preceding seven days, and otherwise `ON_TRACK`. Completed and cancelled assignments have matching terminal due states; no background job mutates rows merely because time elapsed.

Releasing a replacement version atomically cancels open assignments for the superseded version with `VERSION_SUPERSEDED`. Obsolescence cancels open assignments for the withdrawn version with `DOCUMENT_OBSOLETED`. Finalized acknowledgements remain unchanged.

## Completion evidence

Only the assigned user can complete pending work. At completion, the API verifies the current password and active session, reconfirms that the assigned version remains effective and has release evidence, and requires an explicit attestation plus a comment. A conditional update wins once under concurrent requests.

The finalized row stores the fixed meaning `TRAINING_ACKNOWLEDGEMENT`, authentication method `PASSWORD_REAUTHENTICATION`, session, timestamp, comment, and a canonical SHA-256 fingerprint linked to the assigned version, content fingerprint, and release evidence. A database trigger prevents changes after an assignment leaves `ASSIGNED`; the runtime role cannot delete rows.

A successful record means that the participant personally acknowledged reviewing that exact version. It is not an exam, practical assessment, qualification, or proof of competence.

## Deferred scope

Quizzes, competency assessments, curricula, retraining rules, SCORM/LMS integration, email reminders, escalation, bulk cancellation, exports, and signed-record manifestations are deferred. Organizations must operate due-date monitoring and define procedural consequences outside the application until those capabilities are validated.

These controls are audit-ready building blocks and do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

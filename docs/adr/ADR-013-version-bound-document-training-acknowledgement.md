# ADR-013: Version-bound document training acknowledgement

## Status

Accepted — 2026-08-17

## Context

Effective controlled documents must be distributed to the people expected to use them, while preserving which version each person read. A mutable “trained” flag on a user or document cannot distinguish versions, deadlines, replacements, or repeated assignments. A simple checkbox without authentication would also provide weak attribution. At the same time, reading acknowledgement must not be presented as proof of competence.

## Decision

Store each assignment in `training_assignments`, tied to its tenant, controlled document, immutable effective version, participant, assigner, reason, and due timestamp. Permit only one open assignment per tenant, version, and participant through a partial unique index. Derive overdue and due-soon display states from time rather than maintaining them with a scheduler.

Require the participant to be active and permission-qualified with `training.complete`. Only the addressed participant may complete the row. Completion requires the current password, an active session, an explicit acknowledgement, and a comment. Store fixed signature meaning and authentication method values plus a canonical SHA-256 fingerprint linked to the version content and release evidence.

Allow a pending row to transition exactly once to `COMPLETED` or `CANCELLED`. A PostgreSQL trigger freezes identity, schedule, and finalized evidence. The runtime role can select, insert, and perform the one finalizing update, but cannot delete rows. Forced RLS, composite tenant foreign keys, and tenant-aware transactions apply to every operation.

When a replacement becomes effective, cancel open assignments for the superseded version in the same transaction. When an effective document becomes obsolete, cancel its open assignments in the obsolescence transaction. Completed evidence is never rewritten.

## Consequences

- Managers can see pending, overdue, completed, and cancelled work without a background status job.
- Acknowledgement evidence is attributable to a user, active session, immutable version, and released content.
- Replacement and withdrawal cannot leave obsolete reading work open.
- Existing tenants need an explicit role-permission update because default-role initialization runs only when an organization is created.
- Password reauthentication improves attribution but does not by itself satisfy electronic-signature regulations.
- Reading acknowledgement is not a competency assessment; quizzes, practical qualification, curricula, reminders, escalation, and LMS integration remain future work.

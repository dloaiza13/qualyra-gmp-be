# ADR-011: Effective revision, supersession, and obsolescence

## Status

Accepted on 2026-08-14.

## Context

An effective controlled document must remain available while a proposed revision is authored, reviewed, and approved. Treating the document itself as draft during that work would incorrectly suggest that no version is in force. Replacing or withdrawing an effective record also needs explicit, attributable evidence and concurrency-safe transitions.

## Decision

Document status and working-version status represent different concerns after the first release. A document remains `EFFECTIVE` while its latest version can be `DRAFT`, `IN_REVIEW`, or `APPROVED`; the previous version remains `EFFECTIVE` throughout that workflow.

Releasing the approved working version is one transaction that:

1. revalidates password, active session, permission, approval, and segregation;
2. claims the approved version with a conditional update;
3. changes exactly one prior effective version to `SUPERSEDED`;
4. activates the new version and preserves an immutable release whose hash links to the prior release.

Obsolescence is a separate immediate action. It is rejected while a revision is open and requires `documents.release`, password reauthentication, explicit intent, a reason, an active session, and separation from author and approver. Its evidence is stored in an append-only tenant table with forced RLS and no runtime update or delete privilege.

## Consequences

- Readers can distinguish the effective version from work in progress.
- Replacement cannot leave two effective versions after a successful transaction.
- Release and obsolescence attempts are safe against concurrent replay.
- Historical release and withdrawal evidence remains queryable and tenant-isolated.
- Cancellation of an open revision, scheduled effectiveness, periodic review, and reminders require later lifecycle concepts and durable scheduling infrastructure.

These controls support an audit-ready design but do not establish regulatory compliance by themselves.

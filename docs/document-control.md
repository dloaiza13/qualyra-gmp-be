# Controlled document lifecycle

Phase 8 introduced immutable tenant-scoped document versions. Phase 9 added assigned review and approval decisions. Phase 10 added immediate controlled release with password reauthentication and immutable evidence. Phase 11 completed effective revisions, atomic supersession, and controlled obsolescence. Phase 12 adds recurring review of effective documents with due-state visibility and preserved decisions.

## Scope

This phase provides:

- a unique document code per organization;
- document type, owner, creator, and current lifecycle status;
- an immutable history of textual versions;
- an atomic current-version counter that rejects concurrent version races;
- server-side document permissions;
- tenant isolation through composite foreign keys and forced PostgreSQL RLS;
- `DOCUMENT_CREATED` and `DOCUMENT_VERSION_CREATED` security events;
- one review/approval workflow per immutable document version;
- assigned, permission-qualified reviewer and approver;
- server-enforced separation between version author, reviewer, and approver;
- conditional state transitions that reject duplicate or concurrent decisions;
- persistent comments, decision timestamps, and workflow security events.
- release restricted to an approved current version and `documents.release`;
- password reauthentication, explicit intent, signature meaning, and reason;
- an immutable release record tied to user and active session;
- an SHA-256 fingerprint over the version and release evidence;
- immediate transition from `APPROVED` to `EFFECTIVE`.
- a new revision can be drafted and reviewed without withdrawing the previously effective version;
- document-level status remains `EFFECTIVE` while its working version moves through draft, review, and approval;
- releasing an approved revision atomically changes the prior effective version to `SUPERSEDED`;
- obsolescence is restricted to an effective document without an open revision;
- obsolescence requires password reauthentication, explicit intent, segregation of duties, a reason, and immutable SHA-256 evidence.
- a configurable periodic-review interval from 1 to 60 months and an active, permission-qualified reviewer;
- one pending cycle per document, with real-time `UPCOMING`, `DUE_SOON`, or `OVERDUE` classification;
- assigned decisions to confirm effectiveness or require a revision;
- automatic next-cycle creation after confirmation and transfer to a newly released version;
- immutable completed and cancelled cycle history protected by a database transition trigger.

Creating a new draft version marks the previous draft as `SUPERSEDED`. Hard deletion is not exposed and the runtime database role has no delete privilege on either document table.

## API

All routes use the `/api/v1` prefix.

| Method | Route                                                                | Permission          | Purpose                               |
| ------ | -------------------------------------------------------------------- | ------------------- | ------------------------------------- |
| `GET`  | `/documents`                                                         | `documents.read`    | List current document summaries       |
| `GET`  | `/documents/:documentId`                                             | `documents.read`    | Read content and complete history     |
| `POST` | `/documents`                                                         | `documents.create`  | Create document and version 1         |
| `POST` | `/documents/:documentId/versions`                                    | `documents.update`  | Preserve a new current draft version  |
| `POST` | `/documents/:documentId/review-request`                              | `documents.update`  | Assign reviewer and approver          |
| `POST` | `/documents/:documentId/review-decision`                             | `documents.review`  | Accept or reject the review           |
| `POST` | `/documents/:documentId/approval-decision`                           | `documents.approve` | Accept or reject final approval       |
| `POST` | `/documents/:documentId/release`                                     | `documents.release` | Reauthenticate, release, and activate |
| `POST` | `/documents/:documentId/obsolete`                                    | `documents.release` | Reauthenticate and withdraw from use  |
| `POST` | `/documents/:documentId/periodic-reviews`                            | `documents.update`  | Configure or replace the review cycle |
| `POST` | `/documents/:documentId/periodic-reviews/:periodicReviewId/decision` | `documents.review`  | Record the assigned periodic decision |

The list endpoint supports `limit`, `type`, `status`, and `search`. Document codes are normalized to uppercase and are unique only within the authenticated tenant.

## Workflow rules

A draft can be submitted only when its current version has no workflow history. The reviewer and approver must be different active tenant users with the required permissions, and neither can be the current version author. Only the assigned user can make each decision.

An accepted review moves the workflow to `PENDING_APPROVAL`. An accepted approval moves both document and version to `APPROVED`. A rejection at either stage returns them to `DRAFT`; the rejected workflow remains immutable audit history, so the author must create a corrected version before resubmission.

## Release rules

Only the approved current version can be released. The releaser needs `documents.release`, must differ from the version author and approver, and must re-enter the current account password from an active session. The request also carries an explicit acknowledgement, reason, and effective timestamp.

Phase 10 supports immediate effectiveness only: the timestamp must fall between approval and the current server time. Future scheduling is deferred until a durable production scheduler and operational monitoring are selected.

The release stores its fixed meaning (`DOCUMENT_RELEASE`), authentication method (`PASSWORD_REAUTHENTICATION`), actor, session link, timestamps, reason, and a canonical SHA-256 record fingerprint. The runtime role can insert and read release evidence but cannot update or delete it.

## Effective revision and supersession

Creating a version from an effective document starts a revision but does not mutate or withdraw the released version. The document remains `EFFECTIVE`; the latest working version independently moves through `DRAFT`, `IN_REVIEW`, and `APPROVED`. The API exposes both records in the immutable version history, allowing operators to identify what is currently in use and what is being prepared.

When the approved revision is released, one transaction claims the revision, changes it to `EFFECTIVE`, and changes exactly one prior effective version to `SUPERSEDED`. The new release hash links to the prior release fingerprint and version number. Conditional updates reject concurrent or replayed release attempts.

## Obsolescence rules

Obsolescence is an immediate controlled withdrawal, not a replacement. It is allowed only when the latest version is also the effective version; an open draft, review, or approved revision must be resolved first. The signer needs `documents.release`, must differ from the version author and approver, must use an active session, and must re-enter the current password with explicit intent and a reason.

The immutable `document_obsolescences` record links the document, effective version, signer, session, timestamp, reason, authentication method, prior release fingerprint, and its own canonical SHA-256 fingerprint. The runtime database role can select and insert this evidence but cannot update or delete it. A successful action changes both document and version to `OBSOLETE` atomically.

## Periodic review rules

Only an effective document version can receive a periodic-review schedule. The scheduler needs `documents.update`; the assigned reviewer must be an active tenant user with `documents.review` and must differ from the effective version author. Reconfiguring the schedule cancels the prior pending cycle as `SCHEDULE_REPLACED` and creates a new one. PostgreSQL permits at most one pending cycle per document.

Due state is derived when the API response is produced: a pending cycle is `OVERDUE` after its due timestamp, `DUE_SOON` during the preceding 30 days, and otherwise `UPCOMING`. No mutable status job is needed merely to make a cycle overdue.

Only the assigned reviewer can record a decision. `CONFIRM_EFFECTIVE` completes the current cycle and schedules the next one from the decision time using the configured interval. `REVISION_REQUIRED` completes the cycle without scheduling another; the configuration is retained so that releasing a revised version can create its next cycle. Releasing a replacement cancels the old version's pending cycle as `VERSION_SUPERSEDED` and schedules the new effective version when the reviewer remains qualified and separate from its author. Obsolescence cancels the pending cycle as `DOCUMENT_OBSOLETED` and removes the configuration.

Finalized cycle identity, schedule, decision, and cancellation evidence cannot be changed through the runtime role. The database transition trigger allows a pending row to move exactly once to `COMPLETED` or `CANCELLED`, and the runtime role cannot delete rows.

## Compliance boundary

Phases 10 through 12 capture several electronic-signature and lifecycle building blocks, but Qualyra still does not claim 21 CFR Part 11 compliance. Formal validation, signed-record manifestations and exports, identity-proofing policy, trusted time controls, retention, operational procedures, and regulatory assessment remain required. Revision cancellation, durable reminder delivery, escalation, and notification retry monitoring remain out of scope.

Binary files and object storage are also out of scope. Text content is limited to 100,000 characters so the aggregate can be exercised without storing blobs in PostgreSQL or selecting an object-storage provider prematurely.

These controls make the feature audit-ready by design; they do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

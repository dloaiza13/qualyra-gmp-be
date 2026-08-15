# Controlled document lifecycle

Phase 8 introduced immutable tenant-scoped document versions. Phase 9 adds authenticated review and approval decisions with explicit assignments and segregation of duties.

## Scope

This phase provides:

- a unique document code per organization;
- document type, owner, creator, and current lifecycle status;
- an immutable history of textual versions;
- an atomic current-version counter that rejects concurrent version races;
- server-side document permissions;
- tenant isolation through composite foreign keys and forced PostgreSQL RLS;
- `DOCUMENT_CREATED` and `DOCUMENT_VERSION_CREATED` security events.
- one review/approval workflow per immutable document version;
- assigned, permission-qualified reviewer and approver;
- server-enforced separation between version author, reviewer, and approver;
- conditional state transitions that reject duplicate or concurrent decisions;
- persistent comments, decision timestamps, and workflow security events.

Creating a new draft version marks the previous draft as `SUPERSEDED`. Hard deletion is not exposed and the runtime database role has no delete privilege on either document table.

## API

All routes use the `/api/v1` prefix.

| Method | Route                                      | Permission          | Purpose                              |
| ------ | ------------------------------------------ | ------------------- | ------------------------------------ |
| `GET`  | `/documents`                               | `documents.read`    | List current document summaries      |
| `GET`  | `/documents/:documentId`                   | `documents.read`    | Read content and complete history    |
| `POST` | `/documents`                               | `documents.create`  | Create document and version 1        |
| `POST` | `/documents/:documentId/versions`          | `documents.update`  | Preserve a new current draft version |
| `POST` | `/documents/:documentId/review-request`    | `documents.update`  | Assign reviewer and approver         |
| `POST` | `/documents/:documentId/review-decision`   | `documents.review`  | Accept or reject the review          |
| `POST` | `/documents/:documentId/approval-decision` | `documents.approve` | Accept or reject final approval      |

The list endpoint supports `limit`, `type`, `status`, and `search`. Document codes are normalized to uppercase and are unique only within the authenticated tenant.

## Workflow rules

A draft can be submitted only when its current version has no workflow history. The reviewer and approver must be different active tenant users with the required permissions, and neither can be the current version author. Only the assigned user can make each decision.

An accepted review moves the workflow to `PENDING_APPROVAL`. An accepted approval moves both document and version to `APPROVED`. A rejection at either stage returns them to `DRAFT`; the rejected workflow remains immutable audit history, so the author must create a corrected version before resubmission.

## Compliance boundary

Phase 9 decisions are authenticated application actions, not 21 CFR Part 11 electronic signatures. Release, effective dates, signature re-authentication and meaning, signed representation, reason-for-change policies, obsolescence, and periodic review remain future controls.

Binary files and object storage are also out of scope. Text content is limited to 100,000 characters so the aggregate can be exercised without storing blobs in PostgreSQL or selecting an object-storage provider prematurely.

These controls make the feature audit-ready by design; they do not establish GMP, ISO, FDA, or 21 CFR Part 11 compliance.

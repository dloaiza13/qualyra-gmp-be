# ADR-008: Immutable controlled-document draft versions

- Status: Accepted
- Date: 2026-08-14

## Context

The identity and access milestone is complete, and Qualyra now needs its first quality-domain aggregate. Controlled content must be tenant-isolated and traceable, while formal approval and electronic-signature requirements are not yet defined.

## Decision

Represent a controlled document as stable metadata plus ordered, immutable version snapshots:

- `documents` owns the tenant-unique code, type, owner, lifecycle status, and atomic current-version number;
- `document_versions` owns the title, description, textual content, change summary, author, status, and creation timestamp;
- creating a version increments the document counter conditionally and marks the previous draft `SUPERSEDED` in one transaction;
- no update or delete endpoint is exposed for version snapshots;
- both tables use forced RLS and tenant-inclusive foreign keys;
- binary content is not stored in PostgreSQL.

## Consequences

Every saved draft has a stable author and timestamp, version races are rejected, and a tenant cannot reference another tenant's owner or document. The model can later support review, approval, release, and obsolescence without replacing document identity.

Text content is intentionally limited and does not cover signed PDFs or office files. A later ADR must select object storage, malware scanning, checksums, retention, and download authorization before binary uploads are implemented.

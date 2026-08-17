# ADR-019: managed CAPA evidence, durable monitoring, and derived analytics

## Status

Accepted.

## Context

Phase 18 could bind externally stored evidence metadata to an authenticated action, but Qualyra could not verify or retrieve the binary. Due-state labels were calculated only when a user opened the workspace, and quality teams lacked an aggregate view of effectiveness and workload.

## Decision

Add a storage adapter whose initial implementation writes opaque object keys below a configured local root. Upload only to an open action by its assignee, keep the file in memory until validation finishes, accept PDF, PNG, JPEG, and UTF-8 text up to the configured limit, verify magic bytes against the declared media type, reject executable/test-malware signatures, calculate SHA-256, and store tenant-scoped immutable metadata. A safe upload expires if it is not consumed. Action completion consumes selected uploads in the same transaction that creates immutable evidence references and signs their metadata. Downloads recheck SHA-256, require `capas.read`, use tenant RLS, disable caching, and force attachment disposition.

Run a native application monitor at a configurable interval. It derives `DUE_SOON`, `OVERDUE`, and `ESCALATED` from effective action/review dates, creates one tenant-scoped notification per subject, recipient, deadline, and threshold, and delivers bilingual email through a port. A processing lease and bounded retry make work recoverable; escalation also reaches active quality users. Delivery is at-least-once, so an SMTP success followed by a database failure may produce a duplicate.

Expose tenant-scoped CAPA analytics derived from source records at read time: active/closed plans, review effectiveness rate, late/escalated items, status/severity distribution, assignee workload, and recent delivery evidence. Do not create a second mutable analytics truth.

## Consequences

- Development remains free and lightweight; `CAPA_EVIDENCE_STORAGE_ROOT` may point to drive `D:` without adding an object-storage container.
- The storage adapter can later be replaced by an S3-compatible implementation without changing the signed reference contract.
- The built-in validation is defense in depth, not a full malware engine. Production requires an independent scanner/quarantine service, encrypted durable object storage, backup/restore validation, retention policy, and capacity monitoring.
- Files are not linked to immutable evidence until the assignee signs completion. Unconsumed files require a later retention cleanup job; records and binaries already consumed must not be deleted by that job.
- Notification deduplication is durable across restarts and instances, while delivery retains the normal at-least-once SMTP limitation.
- Analytics reflect the current source records and are not a validated statistical-process-control engine.

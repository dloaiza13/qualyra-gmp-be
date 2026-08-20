# Controlled photographic evidence

## Purpose and scope

Qualyra can attach controlled photographs to documents, training assignments, deviations, CAPA, change controls, audits, quality risks, suppliers, equipment, product complaints, recalls/field actions, and PQR/APR records. The same evidence service is reused across modules so custody, validation, quotas, and audit behavior do not diverge by screen.

On a tablet or phone, the frontend exposes a dedicated rear-camera input with `accept="image/*"` and `capture="environment"`, plus a separate gallery selector. Desktop browsers fall back to their standard file chooser. Forms that create deviations, complaints, recalls, or product reviews stage selected photos only in browser memory, create the controlled parent first, and then upload each photo against the returned record ID.

## Custody and integrity

- PostgreSQL stores only tenant-scoped metadata: subject type and ID, original filename, media type, byte count, SHA-256, caption, capture time, scanner result, uploader, and storage object key.
- Image bytes use the managed evidence storage adapter. Local development may use the configured path on `D:`; production must use the existing S3-compatible adapter.
- JPEG, PNG, WebP, HEIC, and HEIF signatures are checked before acceptance. Production configuration already requires the external ClamAV adapter.
- Downloads are authenticated, tenant-scoped, returned with `nosniff` and private no-store caching, and re-hashed before delivery.
- Metadata is append-only. Runtime access has no update or delete grant, a database trigger rejects mutation, and forced Row-Level Security isolates tenants.
- The same image cannot be attached twice to the same parent record in one tenant.

The device-supplied capture time is useful context, not trusted proof of when or where an event occurred. Qualyra does not claim to authenticate EXIF metadata, device identity, or geolocation. Those assurances require validated devices and an approved operating procedure.

## Capacity controls

`PHOTO_EVIDENCE_MAX_BYTES` limits a single image and defaults to 10 MiB. It cannot exceed the managed scanner limit. `PHOTO_EVIDENCE_TENANT_QUOTA_BYTES` limits all photographic evidence for one tenant and defaults to 2 GiB.

Quota checks run inside a tenant-specific PostgreSQL advisory lock, so concurrent uploads cannot both spend the same remaining capacity. If the database transaction rejects an image, the newly written storage object is removed. `GET /api/v1/photo-evidence/usage` returns used, remaining, quota, count, and percentage values for the current tenant.

The API also emits aggregate upload outcome and accepted-byte metrics without tenant labels. This avoids leaking customer identity and prevents unbounded Prometheus label cardinality.

## Production operations

- Provision the S3 bucket outside the application, enable encryption, private access, versioning, lifecycle/retention rules, capacity alarms, and independent backups.
- Set customer quotas from the contracted plan rather than increasing the global default without capacity review.
- Alert on quota rejections, storage/scanner errors, storage growth, latency, and restore-test failures.
- Validate camera capture on the supported iPadOS/Android browser and device matrix before a regulated release.
- Include object storage in disaster-recovery exercises; a PostgreSQL backup alone does not contain image bytes.

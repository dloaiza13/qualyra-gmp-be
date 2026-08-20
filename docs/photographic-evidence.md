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

`PHOTO_EVIDENCE_MAX_BYTES` limits a single image and defaults to 10 MiB. It cannot exceed the managed scanner limit. Storage quotas are selected from the tenant's commercial plan at request time:

| Plan         | Configuration                             | Default |
| ------------ | ----------------------------------------- | ------: |
| Trial        | `PHOTO_EVIDENCE_TENANT_QUOTA_BYTES`       |   2 GiB |
| Starter      | `PHOTO_EVIDENCE_STARTER_QUOTA_BYTES`      |  10 GiB |
| Professional | `PHOTO_EVIDENCE_PROFESSIONAL_QUOTA_BYTES` |  50 GiB |
| Enterprise   | `PHOTO_EVIDENCE_ENTERPRISE_QUOTA_BYTES`   | 200 GiB |

Changing a tenant's plan changes its available quota immediately; it does not copy or move evidence.

Quota checks run inside a tenant-specific PostgreSQL advisory lock, so concurrent uploads cannot both spend the same remaining capacity. A tenant-scoped usage counter makes the normal check O(1); its first access is initialized from immutable evidence metadata and every accepted insert increments it through a database trigger. If the database transaction rejects an image, the newly written storage object is removed. `GET /api/v1/photo-evidence/usage` returns plan, used, remaining, quota, count, percentage, and a bounded capacity state for the current tenant. The defaults are warning at 80% and critical at 95%; configuration validation requires warning to remain below critical and plan quotas to be non-decreasing.

Evidence lists use a stable `(created_at, id)` descending cursor and return at most the requested page plus a `nextCursor`. The UI requests 12 metadata records at a time and continues to lazy-load image bytes only when a card approaches the viewport.

The API also emits aggregate upload, capacity, and reconciliation metrics without tenant labels. This avoids leaking customer identity and prevents unbounded Prometheus label cardinality. The hourly reconciliation initializes a missing operational counter from immutable metadata, but only alerts and logs when an existing counter disagrees; it never silently rewrites a discrepancy.

## Production operations

- Provision the S3 bucket outside the application, enable encryption, private access, versioning, lifecycle/retention rules, capacity alarms, and independent backups.
- Set customer quotas from the contracted plan rather than increasing the global default without capacity review.
- Alert on quota rejections, storage/scanner errors, storage growth, latency, and restore-test failures.
- Validate camera capture on the supported iPadOS/Android browser and device matrix before a regulated release.
- Include object storage in disaster-recovery exercises; a PostgreSQL backup alone does not contain image bytes.
- Compare `tenant_photo_evidence_usage` against an aggregate of immutable metadata during scheduled integrity checks. A mismatch is an operational incident and must not be corrected without preserving its investigation evidence.

## Repeatable operational drills

Start only MinIO from the optional Docker profile and exercise the production S3 adapter against it:

```bash
docker compose --profile managed-evidence up -d --wait minio
npm run ops:evidence:s3-drill
```

The drill creates a unique object, reads and verifies its SHA-256 through the adapter, then removes it. It does not require changing the application's active storage driver.

The capacity drill creates a strictly prefixed temporary PostgreSQL database, applies every migration, loads 50 isolated tenants with 20 photographic metadata rows each, verifies the trigger-maintained counters and cross-tenant RLS under 10 pooled runtime connections, records latency, and drops only that temporary database in `finally`:

```bash
npm run ops:capacity:drill
```

Optional variables control tenant count, photos per tenant, and the local p95 acceptance threshold: `QUALYRA_CAPACITY_DRILL_TENANTS`, `QUALYRA_CAPACITY_DRILL_PHOTOS_PER_TENANT`, and `QUALYRA_CAPACITY_DRILL_MAX_P95_MS`. Run the same command in staging with production-like network and data volume before setting a commercial service objective; a workstation result is a regression baseline, not a production sizing guarantee.

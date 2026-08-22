# Qualyra GMP Backend

Backend API for Qualyra GMP, an audit-ready-by-design quality management SaaS for regulated organizations.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm 11+
- Docker Desktop with WSL 2, or Docker Engine with Compose

## Setup

```bash
cp .env.example .env
npm ci
npm run keys:generate
npm run infra:up
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
npm run start:dev
```

The API listens on `http://localhost:3000`. Mailpit is available at `http://localhost:8025` with the example configuration.

The default evidence pipeline stays lightweight (`local` storage and the built-in signature scanner). To validate the Phase 20 S3/antivirus adapters locally, start the optional profile and select it in `.env`:

```bash
docker compose --profile managed-evidence up --detach --wait
```

Set `CAPA_EVIDENCE_STORAGE_DRIVER=s3` and `CAPA_EVIDENCE_SCANNER=clamav`, then restart the API. MinIO is exposed only on loopback at `http://localhost:9000` (console `http://localhost:9001`) and ClamAV at `127.0.0.1:3310`. ClamAV is intentionally optional because its signature database has a material memory footprint.

## Verification

```bash
npm run lint
npm run typecheck
npx prisma validate
npm run db:generate
npm run test -- --runInBand
npm run test:e2e -- --runInBand
RUN_DATABASE_INTEGRATION=true npm run test:integration
npm run build
npm run start:prod
```

On PowerShell, set the integration flag with:

```powershell
$env:RUN_DATABASE_INTEGRATION = 'true'
npm run test:integration
```

## Infrastructure safety

`npm run infra:reset` refuses to delete volumes unless the explicit `--confirm-data-loss` flag is supplied. See [local development](docs/local-development.md) before resetting infrastructure.

## Backup and recovery drill

Phase 21 provides a non-destructive logical recovery workflow. Configure `QUALYRA_BACKUP_ROOT` (use `D:/qualyra-gmp/backups` on this Windows workstation), then run:

```bash
npm run ops:backup
npm run ops:restore:drill
```

The restore drill validates the SHA-256 manifest, restores into a generated temporary database, verifies migrations and key counts, rechecks runtime RLS, and removes only that temporary database. See [operations and recovery](docs/operations.md).

## Architecture

The backend is a modular NestJS monolith with pragmatic ports and adapters, tenant-aware use cases, PostgreSQL row-level security, and an OpenAPI contract. Business logic must stay out of controllers.

- [Architecture](docs/architecture.md)
- [Local development](docs/local-development.md)
- [Multi-tenancy](docs/multi-tenancy.md)
- [Security](docs/security.md)
- [Authentication](docs/authentication.md)
- [Authorization, users, roles, and invitations](docs/authorization.md)
- [Controlled document lifecycle](docs/document-control.md)
- [Document training](docs/training.md)
- [GMP deviations](docs/deviations.md)
- [Corrective and preventive actions (CAPA)](docs/capa.md)
- [GMP change control](docs/change-control.md)
- [GMP audits and inspections](docs/audits.md)
- [Quality risk management (QRM/FMEA)](docs/quality-risk-management.md)
- [Supplier quality management](docs/supplier-quality-management.md)
- [Equipment, calibration, and maintenance](docs/equipment-management.md)
- [Product quality complaints](docs/product-complaints.md)
- [Product recalls and field actions](docs/product-recalls.md)
- [Periodic product quality reviews (PQR/APR)](docs/product-quality-reviews.md)
- [Controlled photographic evidence and tablet capture](docs/photographic-evidence.md)
- [Contextual help guides](docs/help-guides.md)
- [SaaS multi-tenant scalability](docs/saas-scalability.md)
- [Commercial plan entitlements](docs/commercial-entitlements.md)
- [Operations and recovery](docs/operations.md)
- [Durable notification delivery](docs/notifications.md)
- [Operational observability](docs/observability.md)
- [Deployment runbook](docs/deployment.md)
- [Phase 8 security review](docs/security-review.md)
- [ADR-006: invitation-only organization membership](docs/adr/ADR-006-invitation-only-user-onboarding.md)
- [ADR-008: controlled-document versioning](docs/adr/ADR-008-controlled-document-versioning.md)
- [ADR-009: document review and approval workflow](docs/adr/ADR-009-document-review-approval-workflow.md)
- [ADR-010: password-reauthenticated document release](docs/adr/ADR-010-password-reauthenticated-document-release.md)
- [ADR-011: effective revision, supersession, and obsolescence](docs/adr/ADR-011-effective-revision-supersession-obsolescence.md)
- [ADR-012: recurring periodic review of effective documents](docs/adr/ADR-012-recurring-periodic-document-review.md)
- [ADR-013: version-bound document training acknowledgement](docs/adr/ADR-013-version-bound-document-training-acknowledgement.md)
- [ADR-014: immutable deviation intake and triage](docs/adr/ADR-014-immutable-deviation-intake-and-triage.md)
- [ADR-015: authenticated immutable root-cause investigation](docs/adr/ADR-015-authenticated-immutable-root-cause-investigation.md)
- [ADR-016: immutable CAPA plan and authenticated action execution](docs/adr/ADR-016-immutable-capa-plan-authenticated-action-execution.md)
- [ADR-017: independent CAPA effectiveness and controlled deviation closure](docs/adr/ADR-017-independent-capa-effectiveness-and-controlled-closure.md)
- [ADR-018: controlled CAPA follow-up cycles](docs/adr/ADR-018-controlled-capa-follow-up-cycles.md)
- [ADR-019: managed CAPA evidence, durable monitoring, and derived analytics](docs/adr/ADR-019-managed-capa-evidence-monitoring-analytics.md)
- [ADR-020: S3 evidence custody, external malware scanning, retention, and audit exports](docs/adr/ADR-020-s3-antimalware-retention-audit-exports.md)
- [ADR-021: verified recovery and dependency-backed readiness](docs/adr/ADR-021-verified-recovery-and-operational-readiness.md)
- [ADR-022: transactional notification outbox](docs/adr/ADR-022-transactional-notification-outbox.md)
- [ADR-023: operational metrics and distributed rate limiting](docs/adr/ADR-023-operational-metrics-and-distributed-rate-limiting.md)
- [ADR-024: immutable product complaint investigation](docs/adr/ADR-024-immutable-product-complaint-investigation.md)
- [ADR-025: independent product recall control](docs/adr/ADR-025-independent-product-recall-control.md)
- [ADR-026: signed periodic product review](docs/adr/ADR-026-signed-periodic-product-review.md)
- [ADR-027: separated platform tenant administration](docs/adr/ADR-027-separated-platform-tenant-administration.md)
- [ADR-028: compliance-safe commercial plan entitlements](docs/adr/ADR-028-commercial-plan-entitlements.md)
- [Threat model](docs/threat-model.md)
- [Production readiness checklist](docs/production-checklist.md)

## Compliance position

Qualyra GMP is designed for future validation and traceability. This repository does not claim GMP, ISO, FDA, or 21 CFR Part 11 compliance.

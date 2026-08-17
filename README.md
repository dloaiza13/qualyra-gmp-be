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
- [Threat model](docs/threat-model.md)
- [Production readiness checklist](docs/production-checklist.md)

## Compliance position

Qualyra GMP is designed for future validation and traceability. This repository does not claim GMP, ISO, FDA, or 21 CFR Part 11 compliance.

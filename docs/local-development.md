# Local development

## Prerequisites

- Node.js 24 LTS
- npm 11 or newer
- Docker with the Compose plugin

On Windows, Docker Desktop with the WSL 2 backend is the recommended development configuration.

## First-time setup

Copy `.env.example` to `.env`. The example contains development-only placeholder credentials and must never be reused outside an isolated local environment.

```bash
npm ci
npm run keys:generate
npm run infra:up
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

Prisma CLI commands use `MIGRATION_DATABASE_URL`. Application runtime uses `DATABASE_URL`. `SHADOW_DATABASE_URL` points to a separate disposable development database.

## Services

| Service      | Default port | Purpose                                          |
| ------------ | -----------: | ------------------------------------------------ |
| PostgreSQL   |         5432 | Primary relational database                      |
| Redis        |         6379 | Future rate limiting and background coordination |
| Mailpit SMTP |         1025 | Development email capture                        |
| Mailpit UI   |         8025 | Inspect captured email                           |
| MinIO API    |         9000 | Optional S3-compatible evidence storage          |
| MinIO UI     |         9001 | Optional object-storage console                  |
| ClamAV       |         3310 | Optional external evidence malware scanner       |

MinIO and ClamAV are disabled during the normal lightweight startup. To run the managed-evidence integration profile:

```bash
docker compose --profile managed-evidence up --detach --wait
```

Then set `CAPA_EVIDENCE_STORAGE_DRIVER=s3` and `CAPA_EVIDENCE_SCANNER=clamav` in `.env` and restart the API. The example credentials are local placeholders. ClamAV may take several minutes on its first start while its persistent signature database initializes. When Docker Desktop's disk image is stored on drive D:, these named volumes are stored there as well; do not add hard-coded host paths to the shared Compose file.

After starting the API, Swagger UI is available at `http://localhost:3000/api/docs`. See [authentication](authentication.md) for the browser cookie and CSRF flow.

## Stopping services

```bash
npm run infra:down
```

This keeps named volumes.

## Destructive reset

The following command permanently deletes local PostgreSQL, Redis, MinIO, and ClamAV volumes:

```bash
npm run infra:reset -- --confirm-data-loss
```

Run it only after confirming that no local data needs to be retained. It is never invoked automatically by application code.

## Database verification

After migrations and seed complete:

```bash
RUN_DATABASE_INTEGRATION=true npm run test:integration
```

The test connects with the application login role and verifies tenant filtering, cross-tenant foreign keys, and append-only security events.

## Local recovery evidence

Set `QUALYRA_BACKUP_ROOT=D:/qualyra-gmp/backups` when backups should stay off drive C:, then create and verify a backup without touching the active database:

```bash
npm run ops:backup
npm run ops:restore:drill
```

The second command creates and removes only a generated temporary database. Backup archives and drill reports are intentionally outside Git. See [operations and recovery](operations.md) for data handling and production limitations.

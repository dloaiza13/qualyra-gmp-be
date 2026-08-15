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

After starting the API, Swagger UI is available at `http://localhost:3000/api/docs`. See [authentication](authentication.md) for the browser cookie and CSRF flow.

## Stopping services

```bash
npm run infra:down
```

This keeps named volumes.

## Destructive reset

The following command permanently deletes local PostgreSQL and Redis volumes:

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

# ADR-007: Prisma 7 and PostgreSQL driver adapter

- Status: Accepted
- Date: 2026-08-14

## Decision

Use Prisma ORM 7 in ESM mode with the `prisma-client` generator, an explicit generated-client path, `@prisma/adapter-pg`, and `pg`.

Prisma CLI uses `MIGRATION_DATABASE_URL` through `prisma.config.ts`. Runtime constructs `PrismaClient` with a `PrismaPg` adapter using `DATABASE_URL`.

## Consequences

Generated files are not edited or committed. Prisma Client must be generated before typecheck and build. RLS, grants, triggers, and special checks remain reviewed SQL inside migrations.

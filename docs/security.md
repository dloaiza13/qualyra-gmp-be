# Security foundation

## PostgreSQL roles

Local initialization creates three role categories:

- `postgres`: bootstrap-only superuser used by the container entrypoint;
- a configurable migration owner: non-superuser, object owner, and migration executor;
- a configurable application login: non-superuser, non-owner, without `BYPASSRLS` or schema creation privileges.

The application login inherits a stable `qualyra_runtime` NOLOGIN role. Migrations grant runtime privileges to that role, allowing deployment-specific login names without editing migration SQL.

## Row-level security

Tenant policies use `current_setting('app.tenant_id', true)` through a restricted helper function. RLS is both enabled and forced on tenant-scoped tables.

## Relational integrity

Composite foreign keys include `tenant_id` for relationships between tenant-owned entities. This prevents assigning users, roles, sessions, tokens, or invitations across organizations even if application validation fails.

## Audit trail

`security_events` is append-only. Runtime privileges exclude update and delete, and a database trigger rejects mutations as defense in depth.

## Secrets

`.env.example` contains placeholders only. Production credentials, JWT keys, tokens, and SMTP secrets must come from an approved secret manager and must never be committed or logged.

## Compliance statement

These controls support future validation and traceability. They do not by themselves make the system GMP compliant, ISO certified, FDA approved, or 21 CFR Part 11 compliant.

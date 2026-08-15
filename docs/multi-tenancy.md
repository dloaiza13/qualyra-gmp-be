# Multi-tenancy

Each organization is a tenant identified publicly by a normalized slug. Tenant UUIDs are internal security identifiers and must never be requested in login forms.

## Defense in depth

Tenant isolation has four layers:

1. Repositories must include explicit tenant predicates.
2. Composite foreign keys prevent cross-tenant relationships.
3. PostgreSQL row-level security filters every tenant-scoped table.
4. The application login role is not a superuser, does not own tables, and cannot bypass RLS.

## Transaction-local context

Tenant-scoped operations run through `TenantUnitOfWork`. It opens a Prisma transaction and executes a parameterized call equivalent to:

```sql
SELECT set_config('app.tenant_id', $1, true);
```

The third argument makes the setting transaction-local. Every tenant-scoped query in the use case must use the transaction client supplied by the unit of work.

Do not perform email delivery, HTTP calls, or other slow external work while the database transaction remains open. Write an outbox message inside the transaction and process it afterward.

## Tables

RLS is enabled and forced on users, roles, role assignments, sessions, tokens, invitations, controlled documents, document versions, document workflows, security events, and outbox messages. The global permissions catalog is intentionally not tenant-scoped. Tenant lookup by public slug occurs before a tenant context exists, so the tenants catalog is protected through restricted grants and explicit repository behavior rather than the same RLS policy.

## Verification

`test/rls.integration-spec.ts` must run against a real PostgreSQL instance with `RUN_DATABASE_INTEGRATION=true`. A skipped test is not evidence that RLS works.

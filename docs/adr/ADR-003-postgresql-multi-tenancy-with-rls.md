# ADR-003: PostgreSQL multi-tenancy with RLS

- Status: Accepted
- Date: 2026-08-14

## Decision

Use shared PostgreSQL tables with a mandatory `tenant_id`, composite relational constraints, explicit repository predicates, and forced row-level security driven by transaction-local tenant context.

## Consequences

Every tenant use case must execute through a transaction-aware unit of work. Database integration tests must use the restricted application role. Operational tooling using the owner role must also set tenant context because table owners are subject to forced RLS.

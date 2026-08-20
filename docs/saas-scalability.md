# SaaS multi-tenant scalability

## Current decision

Qualyra uses a shared PostgreSQL database and schema with a mandatory `tenant_id` on tenant-owned records and forced Row-Level Security. This is the appropriate operating model for the first commercial stage, including a scenario with 50 customer organizations.

The number of tenants alone is not the primary capacity driver. Workload is determined by concurrent requests, records per module, evidence-file volume, reporting queries, background jobs, and connection usage. Fifty tenants with ordinary quality-system activity are a modest workload for a properly sized PostgreSQL service.

## Controls that protect growth

- Every application transaction sets and verifies the current tenant context.
- Common access paths use indexes beginning with `tenant_id` and relevant status, due date, product code, or record code.
- List endpoints are bounded; future high-volume screens must use cursor pagination rather than unbounded exports.
- Evidence objects belong in object storage; PostgreSQL stores metadata and references rather than large binaries.
- Durable outbox processing separates notification delivery from user requests.
- Readiness, latency, error, connection-pool, and database metrics must be monitored per environment.
- Backup, restore drills, retention, and migration procedures are shared operational controls.

Phase 31 adds case-insensitive indexes for complaint and recall trend queries by tenant, product code, and creation date.

Phase 32 keeps photographic binaries out of PostgreSQL, enforces a configurable per-tenant storage quota under a concurrency lock, and records only indexed metadata in the shared database. The frontend now splits each quality module into a lazy-loaded chunk; the initial production JavaScript entry decreased from roughly 829 kB to 428 kB before compression, while individual modules load only when opened.

Phase 33 selects photographic quotas from the tenant plan, replaces per-upload aggregate scans with a transactionally maintained usage counter, and paginates evidence metadata using a stable compound cursor. This keeps normal quota checks constant-time and bounds browser/API work even for long-lived regulated records. The counter remains tenant-isolated through forced RLS, while the immutable evidence table remains the reconciliation source of truth.

For 50 customers, capacity planning should therefore use active users, request rate, metadata growth, and object-storage bytes—not the tenant count in isolation. Start with connection-pool, database latency/CPU, HTTP latency/error, object-storage growth, and quota-rejection alerts. Introduce per-plan quotas and load-test targets before self-service onboarding.

## Organization creation policy

The public **Create organization** action is an onboarding policy, not a database-scaling switch. For the initial paid launch, set `ALLOW_PUBLIC_TENANT_REGISTRATION=false` and provision each tenant only after commercial approval. This prevents uncontrolled trials, spam tenants, ambiguous contracts, and resource abuse.

When self-service sales are introduced, organization creation should require verified email, accepted terms, an active subscription or approved trial, quotas, rate limits, and an auditable provisioning workflow. The existing registration-policy endpoint already allows the frontend to hide public registration without changing tenant isolation.

## When to evolve the topology

Keep the shared model while service objectives are met. Consider partitioning, read replicas, or moving unusually large/regulatory customers to dedicated databases only when measured data justifies it, such as:

- sustained database CPU, I/O, or connection saturation;
- tenant tables reaching volumes where partition pruning materially improves plans;
- analytical workloads competing with transactional traffic;
- contractual data-residency or dedicated-environment requirements;
- a single tenant causing a disproportionate share of load.

A hybrid model can preserve the same application-level tenant contract while routing selected enterprise tenants to dedicated database clusters. It should be introduced from measured need, not merely from the count of customer organizations.

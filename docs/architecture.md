# Backend architecture

## Current shape

Qualyra GMP starts as a modular NestJS monolith. Business modules are organized into domain, application, infrastructure, and presentation concerns when those layers contain real code.

The current infrastructure establishes:

- validated environment configuration;
- Prisma 7 with the PostgreSQL driver adapter;
- a tenant-aware unit of work;
- liveness and database-backed readiness probes;
- a PostgreSQL security model enforced below the HTTP layer.

## Dependency direction

Controllers call application services or use cases. Application code depends on ports. Infrastructure adapters implement those ports. Generated Prisma code is confined to database infrastructure and repository implementations.

The frontend and backend remain separate repositories. Their eventual shared contract is OpenAPI, not source imports.

## Deliberate exclusions

Microservices, Kafka, Kubernetes, Elasticsearch, document storage, and distributed infrastructure are not part of the identity and access management milestone.

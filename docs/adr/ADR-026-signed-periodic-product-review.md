# ADR-026: Signed periodic product review with captured trends

- Status: Accepted
- Date: 2026-08-19

## Context

Periodic and annual product quality reviews require a controlled scope, reconciliation of multiple evidence categories, trend interpretation, an accountable conclusion, and independent quality approval. Recomputing analytics after approval would change the evidence considered by the signers.

## Decision

Qualyra stores an immutable product-and-period scope, a password-reauthenticated assessment, a JSON trend snapshot captured at signature time, and an independent approval decision. The current trend preview remains derived data; the signed snapshot becomes immutable evidence.

The shared multi-tenant database remains the deployment default. Tenant/product/date indexes support the new trend queries without creating a database per organization.

## Consequences

- Reviewers can reproduce the facts presented at signing time even as new complaints or recalls are added later.
- Product exposure and source-data interpretation remain human responsibilities.
- Identical product/period scopes cannot be duplicated within one tenant.
- Follow-up requirements are recorded but do not silently create CAPA or change-control records.
- Dedicated databases remain a future enterprise topology option rather than an initial requirement.

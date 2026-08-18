# Deployment runbook

## Release boundary

The backend and frontend deploy independently. This repository supplies application validation, migration, readiness, and recovery-drill controls; the target platform must supply TLS, private networking, encrypted storage, secret management, log collection, alerting, and approved access controls.

Do not treat this runbook as production approval. Every release still requires the applicable quality, security, operations, and validation evidence.

## Required deployment inputs

- Immutable backend and frontend artifacts built from reviewed commits.
- Separate migration/owner, runtime, backup, and support identities.
- Secrets injected from the platform secret manager, never from a committed `.env` file.
- PostgreSQL encrypted connections and a private S3-compatible evidence bucket with versioning and encryption.
- External ClamAV reachable only on a private network.
- Approved RPO, RTO, retention, rollback, and incident owners.

Production environment validation rejects HTTP origins, insecure cookies, plaintext SMTP, local evidence storage, built-in-only scanning, non-HTTPS S3 transport, and runtime S3 bucket creation.

## Pre-deployment

1. Confirm CI passed from the immutable release commit and archive its test/OpenAPI evidence.
2. Review every pending migration for RLS, grants, tenant foreign keys, locks, runtime, and rollback impact.
3. Confirm the latest automated backup/PITR checkpoint is healthy.
4. Create a checksum-manifested logical backup when required by the change plan and run `npm run ops:restore:drill` in an isolated recovery environment.
5. Confirm capacity, ClamAV signature freshness, object-store health, and alert routing.
6. Record change approval, maintenance window, operator, rollback trigger, and stakeholder communication path.

## Deployment order

1. Put incompatible writers into the approved maintenance state when the migration requires it.
2. Run `npm ci` and `npm run db:generate` in the trusted build environment.
3. Apply reviewed migrations once with `npm run db:migrate:deploy` using the migration identity.
4. Deploy the backend artifact with the restricted runtime identity.
5. Require `GET /health/live` and `GET /health/ready` to succeed before routing traffic.
6. Deploy the compatible frontend artifact.
7. Execute smoke tests for login, tenant isolation, document access, CAPA evidence access, and audit export.
8. Observe error, latency, database, scanner, object-store, and delivery signals for the approved stabilization period.

## Failure and rollback

- Stop rollout and preserve correlation IDs, logs, deployment metadata, and timestamps.
- Do not automatically reverse a data migration. Prefer a forward fix when the prior application cannot safely read the new schema.
- If recovery is required, verify the exact target and archive checksum, take a pre-restore copy when possible, and follow the controlled recovery procedure in [operations and recovery](operations.md).
- After restoration, re-run migration identity, key counts, RLS no-context/cross-tenant checks, evidence-object reconciliation, and business smoke tests before reopening traffic.
- Record disposition, data-loss window, achieved RPO/RTO, approvals, and communication evidence.

## Post-deployment evidence

Archive the release commit, dependency/SBOM result when required, migration output, readiness result, smoke-test evidence, backup/restore evidence, alert observations, deviations from plan, and final release approval according to the validated retention policy.

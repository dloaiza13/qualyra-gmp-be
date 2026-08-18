# ADR-021: Verified recovery and dependency-backed readiness

## Status

Accepted for Phase 21.

## Context

A database archive is not recovery evidence until its integrity and restoration have been tested. Likewise, a static “system operational” label is misleading when PostgreSQL or the managed evidence pipeline is unavailable. Qualyra needs safe local tooling that can evolve into a controlled production runbook without granting the API broad backup privileges.

## Decision

- Produce PostgreSQL custom-format logical archives with an atomic write, SHA-256 manifest, migration identity, key counts, and data classification.
- Verify archives by restoring only into a generated `qualyra_restore_drill_*` database, comparing the manifest snapshot, and testing no-context RLS with the runtime role.
- Never implement an unattended destructive restore of the active database.
- Probe PostgreSQL, selected evidence storage, and selected malware scanner in readiness with a bounded timeout and sanitized results.
- Reject production S3 auto-provisioning so runtime credentials do not require bucket-administration privileges.
- Keep production PITR, encryption, immutable retention, evidence-object replication, secret management, scheduling, and recovery approval in the deployment boundary.

## Consequences

- Developers and release operators can produce repeatable restore evidence without risking the active database.
- Backup files are sensitive and require external encryption, access control, retention, and off-machine replication.
- A logical archive does not contain MinIO/S3 evidence binaries or support PITR; those controls must be implemented and tested by the production platform.
- The backup identity necessarily crosses tenant RLS and is therefore a privileged operational credential distinct from the application role.

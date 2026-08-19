# Operations and recovery

## Scope

Phase 21 adds repository-level recovery evidence and truthful operational readiness. It does not provision a production backup service, secret manager, monitoring platform, or point-in-time recovery by itself.

`GET /health/live` proves that the process can answer HTTP. `GET /health/ready` probes PostgreSQL, Redis, the selected CAPA evidence store, and the selected malware scanner concurrently. Each probe has a bounded timeout and returns only a component name, state, and duration; connection strings and error details are never returned.

`GET /metrics` exports authenticated aggregate operational telemetry and the repository includes starter alert rules. See [operational observability](observability.md) for the metric privacy boundary, scraper configuration, Redis failure behavior, and deployment responsibilities.

In production, S3 buckets must be provisioned outside the application. Automatic bucket creation is rejected by environment validation.

## Local backup location

Backups contain tenant and personal data. Keep them outside Git and on an encrypted volume with restricted access. When drive C: is constrained on Windows, configure:

```dotenv
QUALYRA_BACKUP_ROOT=D:/qualyra-gmp/backups
```

The local `.env` may fall back to `POSTGRES_SUPERUSER_PASSWORD`. Production must use a dedicated, tightly controlled backup identity supplied by the deployment secret manager. A complete logical backup must be able to read every RLS-protected tenant; that privilege must never be shared with the API runtime identity.

## Create a logical backup

Keep the PostgreSQL Compose service healthy, then run:

```bash
npm run ops:backup
```

The command opens a read-only repeatable-read transaction, exports its PostgreSQL snapshot, and makes `pg_dump` plus the manifest counts observe that same consistent point in time. It invokes `pg_dump` inside the pinned PostgreSQL container without putting the password in command-line arguments. It writes a compressed custom-format archive atomically, calculates SHA-256, and writes a versioned JSON manifest containing:

- backup identity and timestamp;
- PostgreSQL and migration versions;
- key record counts;
- archive size and SHA-256;
- explicit data-classification warnings.

Partial archives are removed after failure. Completed backups are never pruned automatically.

## Run an isolated restore drill

To verify the newest manifest:

```bash
npm run ops:restore:drill
```

To select one explicitly:

```bash
npm run ops:restore:drill -- --manifest D:/qualyra-gmp/backups/example.manifest.json
```

The drill verifies size and SHA-256 before restoration, creates a uniquely named `qualyra_restore_drill_*` database, restores with `pg_restore --exit-on-error`, compares migrations and record counts, and proves that the application role reads zero tenant rows without RLS context. It writes an immutable-point-in-time JSON report and removes only the drill database in a `finally` block. It never targets the active database.

Restore archives are executable database input. Only restore trusted, access-controlled backups. A failed cleanup should be investigated with a read-only query against `pg_database`; never drop a database whose name does not begin with the controlled drill prefix.

## Production recovery boundary

The logical drill is useful release evidence, but it is not a substitute for continuous production backups. Before launch:

1. Approve RPO and RTO with Quality, Security, Operations, and the product owner.
2. Enable encrypted provider-managed base backups and continuous WAL archiving for point-in-time recovery.
3. Store backups in a separate failure domain with immutability and tested retention.
4. Back up or replicate S3 evidence binaries separately; database dumps contain their references and hashes, not the objects.
5. Provision roles and secrets before restoring a logical archive.
6. Run the drill against an isolated recovery environment, record elapsed time and approvals, and reconcile evidence objects against their database SHA-256 values.
7. Treat any real restore as a controlled change with incident record, maintenance window, verified target, pre-restore backup, rollback decision, and post-restore tenant/RLS checks.

`pg_dump` custom archives support selective and reordered restoration, while high-reliability point-in-time recovery requires base backups plus a continuous WAL archive. Production secret material must be injected by an approved secret manager or platform secret mechanism, not committed `.env` files.

## Primary references

- [PostgreSQL 18: pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)
- [PostgreSQL 18: backup and restore](https://www.postgresql.org/docs/18/backup.html)
- [PostgreSQL 18: continuous archiving and PITR](https://www.postgresql.org/docs/18/continuous-archiving.html)
- [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)

# Production readiness checklist

This checklist is a release gate. Repository controls marked complete still require verification in the actual deployment environment.

## Application and network

- [x] Reject production configuration unless application, web, and CORS origins use HTTPS.
- [x] Use an explicit CORS origin allowlist and restricted methods/headers.
- [x] Apply Helmet headers, strict request validation, and request body limits.
- [ ] Terminate TLS with a managed certificate and redirect HTTP to HTTPS at the edge.
- [ ] Configure trusted proxy hops, forwarded headers, API timeouts, and edge rate limits.
- [ ] Verify CSP and every external resource against the final frontend deployment.
- [ ] Run external penetration and load tests against staging.

## Identity, sessions, and abuse protection

- [x] Use Argon2id passwords, RS256 access tokens, opaque hashed refresh tokens, rotation, and reuse detection.
- [x] Keep access tokens in browser memory; use secure `HttpOnly` refresh cookies and double-submit CSRF.
- [x] Require secure `__Host-` refresh and CSRF cookie names in production.
- [x] Provide session listing and revocation, generic recovery responses, and one-time invitation/recovery tokens.
- [x] Store rate-limit and credential-throttle state atomically in shared Redis and fail protected requests closed when enforcement is unavailable.
- [ ] Select and document CAPTCHA or equivalent bot defense based on the launch threat assessment.
- [ ] Define support procedures for account recovery, compromised administrators, and organization ownership disputes.
- [ ] Keep platform administration disabled or private-network-only; protect and rotate its operator token, assign change authority, and review immutable operator events.

## Data and multi-tenancy

- [x] Run the API with a non-owner, non-superuser role without `BYPASSRLS`.
- [x] Force RLS on tenant tables and test no-context and cross-tenant isolation.
- [x] Use tenant-aware composite foreign keys and append-only security events.
- [ ] Provision production owner, migrator, runtime, and read-only support roles with separate credentials.
- [ ] Require encrypted database connections and restrict network access.
- [ ] Enable encrypted automated backups and point-in-time recovery.
- [ ] Complete and record a restoration drill with measured recovery objectives.
- [x] Provide checksum-manifested logical backup tooling and an isolated restore drill that rechecks RLS.
- [ ] Review RLS, grants, and tenant constraints for every new migration.
- [x] Reject production CAPA evidence configuration without S3-compatible HTTPS storage and external ClamAV scanning.
- [ ] Enable and verify object-store encryption at rest, versioning, lifecycle controls, private networking, and least-privilege credentials.

## Secrets, logs, and monitoring

- [x] Redact credentials, cookies, CSRF, token fields, response cookies, and URL query values from application logs.
- [x] Return generic unexpected errors with correlation identifiers.
- [ ] Store JWT keys, the outbox payload key, database, Redis, and SMTP credentials in an approved secret manager.
- [ ] Define rotation frequency, emergency rotation, and access-review ownership.
- [ ] Send structured logs to access-controlled storage and verify exporter-side redaction.
- [ ] Alert on login abuse, token reuse, tenant-isolation failures, email failures, elevated 5xx rates, database saturation, and backup failures.
- [ ] Alert quality owners on overdue or critical deviations and define acknowledged escalation paths.
- [ ] Define retention, deletion, privacy, and incident-evidence policies.
- [ ] Monitor ClamAV signature freshness, scanner health, retention failures, and orphaned `PURGING` evidence.
- [x] Make API readiness depend on PostgreSQL, Redis, selected evidence storage, and selected malware scanner with bounded probes.
- [x] Export authenticated, low-cardinality HTTP, process, dependency, and outbox metrics without tenant labels.
- [ ] Deploy the metric scraper, secure its token and network path, tune thresholds, assign routes/runbooks, and exercise every alert.

## Email and asynchronous work

- [x] Require SMTP TLS in production configuration.
- [x] Make invitation, verification, and recovery tokens single-use and time-limited.
- [x] Implement a transactional outbox and worker with retry, enqueue idempotency, and dead-letter handling.
- [x] Export outbox worker metrics and version starter alerts for dead letters, retry rate, lease recovery, delivery latency, and liveness.
- [ ] Configure SPF, DKIM, DMARC, verified sending domains, bounce handling, and provider alerts.
- [ ] Validate every email link against the production web origin.

## Delivery and operations

- [x] CI installs from lockfiles and runs audit, lint, type-check, tests, database isolation, build, browser flows, and OpenAPI drift checks.
- [x] CI permissions are read-only and duplicate branch runs are cancelled.
- [ ] Protect the main branch, require reviews and all CI checks, and restrict deployment environments.
- [ ] Pin third-party CI actions to reviewed commit digests for higher assurance.
- [ ] Automate reviewed migrations with pre-deployment backup and failure handling.
- [ ] Create rollback, incident response, disaster recovery, and status communication runbooks.
- [x] Document a release sequence with pre-deployment backup evidence, readiness gates, smoke tests, and controlled recovery boundaries.
- [ ] Assign on-call ownership and test alerts before accepting users.
- [ ] Produce a software bill of materials and archive release evidence if required by the validation plan.

## Product validation and approval

- [x] Document that audit-ready controls do not themselves constitute regulatory compliance.
- [x] Maintain a threat model and point-in-time security review.
- [ ] Approve data classification, privacy terms, subprocessors, retention, and regional requirements.
- [ ] Complete user requirements, risk assessment, validation plan, test evidence, traceability, and release approval appropriate to the intended regulated use.
- [ ] Obtain explicit security, quality, operations, and product owner sign-off.

Production launch is blocked until every applicable unchecked item has an owner, evidence, and an approved disposition.

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

## Authentication controls

Passwords use Argon2id. Access tokens use asymmetric RS256 signing, while refresh and one-time email tokens are opaque and stored only as hashes. Refresh rotation includes reuse detection and session-family revocation. Cookie mutations enforce an origin allowlist and double-submit CSRF protection. Security-sensitive operations append structured events with correlation identifiers.

Production hardening still requires selecting a CAPTCHA or equivalent bot-defense provider, deploying and exercising the exported telemetry/alerts, and integrating provider bounce/complaint feedback.

HTTP logs remove URL query values and redact authorization, cookie, CSRF, password, token, and response-cookie fields. Production configuration also requires HTTPS origins, secure `__Host-` cookie names, and SMTP TLS.

## Authorization controls

Protected operations resolve the caller's current roles and permissions from PostgreSQL instead of trusting stale permission claims in access tokens. Tenant-scoped application checks, composite foreign keys, and RLS provide layered isolation.

Membership onboarding for an existing organization is invitation-only. Public creation of a new organization is controlled independently by `PUBLIC_REGISTRATION_ENABLED`. Invitation domain records retain only token hashes; the encrypted delivery payload is purged after send or cancellation. Resending rotates the token and cancels the prior pending message. Acceptance, role assignment, user creation, and session creation are atomic. A serialized last-administrator check prevents an organization from losing its final active administrator. See [authorization, users, roles, and invitations](authorization.md).

## Compliance statement

These controls support future validation and traceability. They do not by themselves make the system GMP compliant, ISO certified, FDA approved, or 21 CFR Part 11 compliant.

## Operational security documents

- [Phase 6 security review](security-review.md)
- [Threat model](threat-model.md)
- [Production readiness checklist](production-checklist.md)

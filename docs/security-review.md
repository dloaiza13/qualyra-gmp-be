# Phase 8 security review

Review date: 2026-08-14

## Result

The Phase 6 repository hardening review was a point-in-time result. The current backend audit reports a high-severity `deepmerge-ts` advisory through Prisma configuration tooling; npm currently proposes only a forced breaking Prisma downgrade. It remains tracked rather than applying an unsafe automated downgrade.

## Review evidence

| Area                  | Result                            | Evidence                                                                                                                                                                                       |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependencies          | Pass                              | Lockfiles are committed; CI uses `npm ci` and rejects high or critical audit findings.                                                                                                         |
| HTTP logging          | Pass                              | Authorization, cookies, CSRF, password/token fields, response cookies, and all query values are removed or redacted. Unit tests cover query-token removal.                                     |
| Error responses       | Pass                              | Unexpected errors are generic; validation responses expose field/constraint names without submitted credential values or stack traces. API tests cover both paths.                             |
| Cookies and CSRF      | Pass with deployment verification | Production configuration requires secure `__Host-` refresh and CSRF cookie names, strict same-site behavior, exact origin checks, and HTTPS application URLs.                                  |
| CORS and headers      | Pass                              | CORS uses an explicit origin allowlist and restricted methods/headers. Helmet security headers and disallowed-origin behavior have API tests.                                                  |
| Tenant isolation      | Pass                              | Tenant tables force RLS; the runtime role is non-owner and lacks `BYPASSRLS`; no-context and cross-tenant integration tests are present.                                                       |
| Authorization         | Pass                              | The API resolves current database permissions and tests denial, tenant isolation, last-administrator protection, invitation atomicity, and append-only events.                                 |
| CI                    | Pass                              | Concurrency cancellation, least-privilege repository permissions, dependency audit, static checks, tests, database integration, build, browser tests, and contract drift gates are configured. |
| Internationalization  | Pass                              | Spanish and English UI catalogs, accessible switch, locale-aware dates, persistence, and unit/browser tests are implemented. Only the locale preference is stored locally.                     |
| Onboarding governance | Pass                              | New-organization registration is configurable, existing-organization membership remains invitation-only, and resending rotates the token while preserving a tenant-scoped audit trail.         |
| Document foundation   | Pass                              | Document metadata and versions use composite tenant foreign keys, forced RLS, immutable snapshots, conditional version creation, server permissions, and security events.                      |

## Open risks before production

The repository is ready for continued product development, but it is not yet approved for a public production launch. The following items remain release blockers:

1. Deploy and harden the production Redis service, metric scraper, alert routing, dashboards, and owned runbooks; exercise the versioned alerts before launch.
2. Add email-provider bounce, complaint, and suppression feedback handling.
3. Provision an approved secret manager, managed TLS, restricted production database roles, encrypted automated backups/PITR, and run the repository restore drill in the production recovery environment.
4. Configure centralized logs while preserving the repository's redaction rules.
5. Perform staging penetration testing, load testing, disaster-recovery rehearsal, and the product's formal validation/risk process.
6. Decide whether CAPTCHA or another bot defense is justified from the launch threat profile.
7. Trace and remove the PostgreSQL client concurrent-query deprecation warning before adopting `pg` 9.

See the [threat model](threat-model.md) and [production checklist](production-checklist.md) for ownership and verification details.

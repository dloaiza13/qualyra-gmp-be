# Authentication

## Public lifecycle

The public API is rooted at `/api/v1/auth` and supports company registration, slug availability, login, refresh, logout, password recovery, and email verification. There is deliberately no public endpoint for creating a user inside an existing tenant; internal users are created only through invitations.

`GET /api/v1/auth/registration-policy` exposes the non-sensitive onboarding policy required by the public UI. `publicCompanyRegistrationEnabled` follows `PUBLIC_REGISTRATION_ENABLED`, while `existingOrganizationMembership` is always `INVITATION_ONLY`. This keeps public creation of a new organization independently configurable without allowing a person to self-enroll in an existing tenant.

`GET /api/v1/auth/tenant-availability?slug=acme-pharma` supports the debounced registration UX. It is rate limited and advisory only; registration still enforces the unique database constraint inside its transaction.

Company registration is one database transaction. It creates the tenant, the first active user, the five system roles, the Administrator assignment, all Administrator permissions, a session, a hashed refresh token, an email-verification token, and the initial security event. A duplicate slug rolls the entire transaction back.

## Token model

- Access tokens are short-lived RS256 JWTs returned in JSON. They contain identifiers and token version only; authorization permissions are never embedded.
- Refresh tokens are opaque, random values stored only as SHA-256 digests. They are delivered in an `HttpOnly`, `SameSite=Strict`, path-root cookie and rotate on every successful refresh.
- Reuse of an already rotated refresh token revokes the complete compromised session and its token family.
- Password resets and email verifications use expiring, one-time opaque tokens stored only as digests in their domain tables. Their pending email payload is encrypted in the transactional outbox and purged after delivery or cancellation.

Production requires secure cookies and a refresh-cookie name with the `__Host-` prefix. JWT private keys, SMTP credentials, and database credentials must come from the deployment secret manager.

## Browser protections

Cookie-authenticated mutations require both a trusted `Origin` or `Referer` and a double-submit CSRF token in the `x-csrf-token` header. Allowed origins are an explicit configuration list, and CORS credentials are enabled only for those origins. Bearer-authenticated endpoints do not rely on cookies.

The login response is intentionally generic for unknown tenants, unknown users, and incorrect passwords. Argon2id dummy verification reduces timing disclosure. Separate IP and normalized tenant/email throttles plus progressive account locking limit repeated guesses. Throttle state is stored atomically in shared Redis so every API instance enforces the same budget. CAPTCHA remains a documented production hardening item; it is not implemented because no provider has been selected.

## Local use

Generate development-only RSA keys once, then start the API:

```bash
npm run keys:generate
npm run start:dev
```

Swagger UI is available only in development at `http://localhost:3000/api/docs`. Mailpit captures verification and reset messages at `http://localhost:8025`. The committed machine-readable contract is `openapi.json` and can be regenerated with `npm run openapi:generate`.

## Verification

The database integration suite exercises the complete authentication lifecycle with real PostgreSQL RLS:

```powershell
$env:RUN_DATABASE_INTEGRATION = 'true'
npm run test:integration
```

The test covers the public registration policy, slug availability, atomic tenant provisioning, duplicate slugs, generic login failures, Argon2id hashes, session ownership, refresh rotation and reuse detection, logout, password reset revocation, email verification, response redaction, and security-event creation.

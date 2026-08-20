# Controlled platform administration

## Security boundary

Tenant administrators are not platform operators. A tenant JWT can manage only its own organization through forced RLS and can never list or change other tenants. The commercial operations API uses a separate opaque bearer token, is disabled by default, and must be exposed only on an approved private operator network.

Configure it through a secret manager:

```dotenv
PLATFORM_ADMIN_ENABLED=true
PLATFORM_ADMIN_BEARER_TOKEN=<at-least-48-random-characters-in-production>
PLATFORM_OPERATOR_ID=commercial-operations
```

Production validation rejects the committed local token when the API is enabled. The authorization header is redacted from application logs. Rotate the token after suspected exposure and keep independent network restrictions, access logs, and operator procedures; the initial shared-token control is not a replacement for workforce SSO and MFA.

## API contract

- `GET /api/v1/platform/tenants` lists a bounded page with plan, status, aggregate user counts, and photographic evidence capacity. It supports `search`, `plan`, `status`, `cursor`, and `limit`.
- `GET /api/v1/platform/tenants/:tenantId` returns one commercial tenant summary.
- `PATCH /api/v1/platform/tenants/:tenantId` changes plan and/or service status and requires a meaningful reason plus the last observed `expectedUpdatedAt` value.
- `GET /api/v1/platform/audit-events` returns immutable operator-change evidence and supports tenant and cursor filters.
- `GET /api/v1/organization/commercial-summary` is the authenticated tenant-facing endpoint. It never returns another organization's data.

Every successful commercial change appends a global immutable audit event with the configured operator ID, correlation ID, reason, prior and next state, capacity context, and revoked-session counts. Runtime database privileges cannot update or delete these events, and a database trigger also rejects mutation.

## Operational behavior

- Changing a plan updates capacity immediately; it never moves or deletes evidence.
- A downgrade below current storage requires `acknowledgeOverQuota=true`. Existing evidence remains readable, while new uploads remain blocked by the normal quota control.
- Moving an active tenant to `SUSPENDED` or `DISABLED` atomically revokes its active sessions and refresh tokens.
- Reactivating a tenant does not restore revoked sessions; users must authenticate again.
- `expectedUpdatedAt` is mandatory, provides optimistic concurrency, and rejects a stale operator change.
- A request that makes no change is rejected and is not written as a misleading audit event.

## PowerShell example

Keep the token in the process environment and never paste it into source control or support tickets:

```powershell
$headers = @{ Authorization = "Bearer $env:PLATFORM_ADMIN_BEARER_TOKEN" }
$tenants = Invoke-RestMethod `
  -Headers $headers `
  -Uri "http://localhost:3000/api/v1/platform/tenants?limit=25"

$tenant = $tenants.items[0]
$body = @{
  plan = "PROFESSIONAL"
  reason = "Approved Professional subscription order Q-2026-0042."
  expectedUpdatedAt = $tenant.updatedAt
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Patch `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body `
  -Uri "http://localhost:3000/api/v1/platform/tenants/$($tenant.id)"
```

For the initial launch, keep public organization registration disabled and provision commercial customers through an approved onboarding runbook. Billing-provider automation, per-seat enforcement, operator SSO/MFA, and a separate internal operator frontend remain later controls.

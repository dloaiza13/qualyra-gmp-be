# Commercial plan entitlements

## Plan matrix

Commercial entitlements are enforced by the API and returned to both the tenant workspace and the private platform console. UI visibility is only a convenience; it is not the security boundary.

| Plan         | Committed user limit | Writable modules                                                             | Trial duration |
| ------------ | -------------------: | ---------------------------------------------------------------------------- | -------------: |
| Trial        |                    5 | All modules                                                                  |        30 days |
| Starter      |                   10 | Documents, training, deviations, CAPA, change control, photographic evidence | Not applicable |
| Professional |                   50 | All modules                                                                  | Not applicable |
| Enterprise   |            Unlimited | All modules                                                                  | Not applicable |

A committed user is either a user whose status is not `DISABLED` or a non-expired pending invitation. Counting invitations reserves their future seat and prevents concurrent administrators from oversubscribing a tenant.

## Compliance-safe restriction behavior

- A plan change never deletes records, evidence, users, or files.
- Modules excluded from a plan remain readable so historical GMP records can still be inspected and exported where an export permission exists. Their mutations are rejected with `PLAN_FEATURE_NOT_AVAILABLE`.
- An expired trial remains accessible in read-only mode. Mutations are rejected with `TRIAL_EXPIRED`.
- A canceled, expired, or elapsed grace subscription remains accessible in read-only mode. Mutations are rejected with `SUBSCRIPTION_INACTIVE`.
- When all seats are committed, a new invitation or a disabled-user reactivation is rejected with `PLAN_USER_LIMIT_REACHED`.
- An already pending invitation can still be accepted because it already reserved a seat. A trial expiration still blocks acceptance.
- Personal security actions such as viewing and revoking sessions do not depend on commercial module permissions.

The authenticated `/api/v1/auth/me` and `/api/v1/organization/commercial-summary` responses include the effective plan limits, seat usage, trial state, and per-module `FULL` or `READ_ONLY` access. `/api/v1/auth/me` returns effective permissions after both RBAC and commercial restrictions are applied.

## Controlled plan changes

The private platform API validates both storage and committed-user capacity before a downgrade:

- `acknowledgeOverQuota=true` records acceptance of existing storage above the new quota.
- `acknowledgeUserOverage=true` records acceptance of existing user commitments above the new limit.

Acknowledgement preserves existing data and access; it does not grant extra capacity. New uploads or invitations remain blocked until usage returns within the plan or the plan is upgraded. All acknowledgements, counts, limits, trial dates, and operator reasons are stored in the immutable platform audit event.

Switching a paid tenant to Trial starts one new 30-day period and is an audited operator action. Extending an active Trial without a plan change is intentionally not supported by this contract.

## Deployment

Apply `20260820060000_commercial_plan_entitlements` before deploying the new application version. It adds `tenants.trial_ends_at` and backfills existing Trial tenants to 30 days after their original creation time. Review older Trial tenants before production deployment because they may become read-only immediately when their historical 30-day period has elapsed.

The provider-neutral subscription lifecycle is documented separately in [subscription-lifecycle.md](subscription-lifecycle.md). A real provider still requires a signature-verifying adapter before any public webhook is exposed.

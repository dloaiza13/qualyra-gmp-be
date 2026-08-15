# Authorization, users, roles, and invitations

Phase 4 adds tenant-scoped role-based access control (RBAC) and the only supported workflow for adding internal users.

## Authorization model

Authenticated routes use `JwtAuthGuard` followed by `PermissionsGuard`. Controllers declare the required permissions with `@Permissions(...)`. The guard queries the current user's active roles and permissions from PostgreSQL for every protected request instead of trusting permission claims embedded in an access token. Role or status changes therefore take effect immediately.

The application validates tenant ownership and the database enforces it again with composite foreign keys and row-level security. A resource owned by another tenant is never returned to the caller.

## Built-in roles

Organization registration creates these system roles:

- Administrator
- QA Manager
- Document Controller
- Operator
- Auditor

System-role names are immutable. The Administrator role keeps the full platform permission set and cannot be reduced. Tenant administrators can create and update custom roles.

## Last-administrator protection

An organization must always retain at least one active user with the Administrator role. Disabling, locking, or removing that role from the last active administrator is rejected with `LAST_ADMINISTRATOR_REQUIRED`.

The check locks the tenant row inside the same transaction as the mutation, preventing two concurrent requests from removing the final administrators at the same time.

Disabling or locking a user also revokes their active sessions and outstanding refresh tokens.

## Invitations

Direct user creation is not exposed. An administrator must create an invitation with one or more roles that belong to the same tenant.

Invitation controls:

- the raw token is delivered by email and is never persisted;
- only a SHA-256 token hash is stored;
- invitations expire, can be revoked, and can be accepted only once;
- resending rotates the token, invalidates the previous link, renews expiration, and records `lastSentAt`;
- accepting an invitation creates the verified user, assigns roles, opens a session, and consumes the invitation atomically;
- preview accepts the token in a request body so it is not placed in a URL or ordinary access log;
- duplicate pending invitations and cross-tenant role assignments are rejected.

In local development, invitation emails can be inspected in Mailpit at `http://localhost:8025`.

## API routes

All routes use the `/api/v1` prefix.

| Method   | Route                                     | Required permission                  |
| -------- | ----------------------------------------- | ------------------------------------ |
| `GET`    | `/users`                                  | `users.read`                         |
| `GET`    | `/users/:userId`                          | `users.read`                         |
| `PATCH`  | `/users/:userId/status`                   | `users.change_status`                |
| `PATCH`  | `/users/:userId/roles`                    | `users.assign_roles`, `roles.assign` |
| `GET`    | `/roles`                                  | `roles.read`                         |
| `GET`    | `/roles/permissions`                      | `roles.read`                         |
| `POST`   | `/roles`                                  | `roles.create`, `roles.assign`       |
| `PATCH`  | `/roles/:roleId`                          | `roles.update`, `roles.assign`       |
| `GET`    | `/users/invitations`                      | `users.read`                         |
| `POST`   | `/users/invitations`                      | `users.invite`, `roles.assign`       |
| `POST`   | `/users/invitations/:invitationId/resend` | `users.invite`                       |
| `DELETE` | `/users/invitations/:invitationId`        | `users.invite`                       |
| `GET`    | `/security-events`                        | `security.events.read`               |
| `POST`   | `/invitations/preview`                    | Public, rate limited                 |
| `POST`   | `/invitations/accept`                     | Public, rate limited                 |

OpenAPI is available at `http://localhost:3000/api/docs` while the API is running.

## Security events

The following Phase 4 operations append tenant-scoped security events:

- `USER_INVITED`
- `INVITATION_RESENT`
- `INVITATION_REVOKED`
- `USER_STATUS_CHANGED`
- `ACCOUNT_UNLOCKED`
- `USER_ROLES_CHANGED`
- `ROLE_CREATED`
- `ROLE_UPDATED`

Invitation acceptance also creates the authentication session events defined in the authentication phase. Token hashes and password hashes are excluded from API responses.

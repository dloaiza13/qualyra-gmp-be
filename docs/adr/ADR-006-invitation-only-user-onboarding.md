# ADR-006: Invitation-only membership for existing organizations

- Status: Accepted
- Date: 2026-08-14

## Context

Qualyra is a multi-tenant B2B system for regulated organizations. A public user must not be able to choose an existing organization and grant themselves membership. At the same time, an operator may want to permit self-service creation of entirely new organizations during an early SaaS launch.

## Decision

Use a hybrid onboarding model:

- public creation of a new organization is controlled by `PUBLIC_REGISTRATION_ENABLED`;
- membership in an existing organization is invitation-only;
- an authorized administrator chooses the email address and initial roles;
- invitation tokens are random, expire, are stored only as hashes, and are consumed atomically;
- resending an invitation rotates the token, invalidates the previous link, renews expiration, and appends an `INVITATION_RESENT` security event;
- the public UI reads `GET /api/v1/auth/registration-policy` and fails closed if the policy cannot be loaded.

## Consequences

This prevents open enrollment and makes the person who authorized access, initial role assignment, and invitation lifecycle traceable. It also preserves a configurable product-led path for creating a brand-new tenant.

Administrators must manage invitation delivery and resend requests. The system therefore needs durable email delivery, monitoring, and secure administrator recovery before production launch.

## Alternatives considered

- Open self-enrollment into an existing tenant was rejected because email-domain matching alone does not prove authorization and can create excessive privilege.
- A completely closed, sales-provisioned model remains available by disabling public organization registration.
- Enterprise SSO just-in-time membership may be added later only through a tenant-controlled enterprise connection or verified domain, with an explicit default-role policy and audit events.

# ADR-010: Password-reauthenticated document release

- Status: Accepted
- Date: 2026-08-14

## Context

Approved document versions need a controlled transition to effective use. A bearer access token alone does not provide sufficient evidence of fresh intent for this high-impact action, and release evidence must not be editable by the runtime application role.

## Decision

Create one immutable `document_releases` record per version and require:

- an approved current version;
- the `documents.release` permission;
- a releaser different from the version author and approver;
- password reauthentication against the current password hash;
- an active session linked by a tenant-inclusive foreign key;
- an explicit acknowledgement, reason, and immediate effective timestamp;
- conditional document/version transitions to `EFFECTIVE`;
- a canonical SHA-256 fingerprint over the version and release evidence;
- forced RLS, insert/read-only runtime grants, and success/failure security events.

Password hashing is performed outside a database transaction. State, session, and password-hash identity are rechecked inside the final transaction before the conditional release.

## Consequences

The application can demonstrate fresh authentication, intent, meaning, attribution, and record integrity for document release. Concurrent release attempts serialize to one success, and failed password verification is audited without storing the submitted password.

This design is compatible with a future regulated electronic-signature program but is not, by itself, a 21 CFR Part 11 claim. Signed manifestations, validation evidence, identity proofing, trusted clocks, retention, and operating procedures remain necessary.

# ADR-009: Version-bound document review and approval

- Status: Accepted
- Date: 2026-08-14

## Context

Immutable document drafts need formal decisions without allowing an actor to overwrite history or approve their own authored version. Tenant isolation and role permissions alone do not establish the assignment or transition rules.

## Decision

Store one `document_workflows` record per document version. It names the requester, reviewer, and approver, and records review and approval comments and timestamps.

- reviewer and approver must be different active tenant users;
- both assignees must currently hold the required permission;
- the version author can be neither reviewer nor approver;
- only the named assignee can decide their stage;
- conditional updates serialize decisions and return a stable conflict on races;
- rejection preserves the workflow, restores the document to draft, and requires a new version before resubmission;
- the table uses tenant-inclusive foreign keys, forced RLS, and no runtime delete grant.

## Consequences

A decision is attributable to an authenticated user, immutable document version, comment, and timestamp. Rejected and approved histories cannot be silently reused or deleted by the runtime application role.

This is not an electronic signature. A later ADR must define re-authentication, signature intent and meaning, signed-record rendering, release authority, effective dates, and validation evidence before a regulated signature claim is made.

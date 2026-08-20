# ADR-025: Independent control of product recalls and field actions

- Status: Accepted
- Date: 2026-08-19

## Context

Market actions can affect patient safety, regulatory obligations, customers, inventory, and reputation. A generic editable task record does not provide sufficient evidence of the assessment, authorization, execution, and reconciliation decisions.

## Decision

Qualyra will model a field action as an immutable intake followed by separate append-only records for:

- signed risk assessment;
- independent signed approval or rejection;
- cumulative execution updates; and
- signed effectiveness and reconciliation closure.

The assessor and decision signer must be different users. The assigned independent approver also signs closure. Password reauthentication, an active matching session, record hashes, tenant-scoped foreign keys, forced RLS, permissions, and database lifecycle triggers are required.

Regulatory reporting and external communication are documented through plans and references but are not executed by the application.

## Consequences

- The evidence chain remains reconstructable without relying on mutable history fields.
- Recovery and destruction totals cannot decrease and cannot exceed distributed units.
- Organizations retain accountability for jurisdiction-specific classification, notification, communication, and physical execution.
- Future integrations with authority portals or logistics systems require separate validation and explicit authorization.

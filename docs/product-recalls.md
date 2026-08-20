# Product recalls and field actions

The recalls module provides a tenant-isolated, audit-ready workflow for recalls, market withdrawals, field corrections, safety notices, and stock recovery.

## Controlled lifecycle

1. An authorized user reports an immutable field-action signal. Qualyra assigns `RCL-YYYY-NNNN`.
2. A qualified assessor signs the health-hazard, scope, classification, depth, communication, and regulatory-reporting assessment after password reauthentication.
3. A different assigned approver signs an approval or rejection decision.
4. Authorized execution users append cumulative notification, response, recovery, destruction, and regulatory-communication evidence.
5. The independent approver signs the final effectiveness and reconciliation closure.

Rejected, cancelled, and closed records are terminal. Signed assessments, decisions, execution updates, and closures are append-only and protected by database triggers as well as application checks.

## Links to complaints

A field action may reference a closed product complaint only when its signed complaint decision says recall action is required. Standalone signals remain possible when a different controlled source reference is supplied.

## Regulatory boundary

Qualyra records whether reporting is required and stores authority references. It does not submit notifications to health authorities, determine jurisdiction-specific legal deadlines, contact customers, or initiate physical product movement automatically. Those activities remain under the organization's approved procedures and accountable functions.

## Permissions

- `recalls.read`
- `recalls.create`
- `recalls.assess`
- `recalls.approve`
- `recalls.execute`
- `recalls.close`
- `recalls.cancel`

All persisted tables use forced PostgreSQL row-level security with the current tenant context.

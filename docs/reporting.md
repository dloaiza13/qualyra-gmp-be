# Operational reporting

The `GET /api/v1/reports/operational` endpoint provides tenant-isolated quality
analytics for a creation-date period. It aggregates records in PostgreSQL and
does not transfer complete process records to the client.

## Authorization

The endpoint requires `reports.read`. A process is included only when the
effective session permissions also provide organization-wide access for that
process, such as `deviations.read_all`. Training uses `training.assign`, which
is its existing organization-wide assignment permission. Commercial plan
entitlements are evaluated before report generation, so a report cannot expose
a module unavailable in the tenant plan.

The default Administrator, QA Manager, Document Controller, and Auditor roles
receive `reports.read`. Operators continue to use the role-scoped Dashboard.
Document Controllers see document and training analytics; Auditors do not see
organization-wide training because their default role only allows personal
training assignments.

## Period and metrics

- `from` and `to` are optional ISO dates and are inclusive in the response.
- The default period starts on the first day of the month eleven months ago and
  ends today.
- The maximum range is five years.
- The period selects records by creation date. Open, overdue, critical, training
  compliance, and CAPA effectiveness are evaluated when the report is generated.
- CAPA action extensions are considered when identifying overdue CAPA records.
- A quality-risk record is critical when its current residual RPN, or its
  initial RPN when no residual value exists, is greater than 80.

The response contains overall KPIs, per-process status buckets, and monthly
creation trends. CSV generation and print-to-PDF are presentation concerns in
the web client; they only use the authorized aggregate response.

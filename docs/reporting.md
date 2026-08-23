# Operational reporting

The `GET /api/v1/reports/operational` endpoint provides tenant-isolated quality
analytics for a creation-date period. It aggregates records in PostgreSQL and
does not transfer complete process records to the client.

## Authorization

The analytics endpoint requires `reports.read`. The PDF endpoint also requires
`reports.export`. A process is included only when the
effective session permissions also provide organization-wide access for that
process, such as `deviations.read_all`. Training uses `training.assign`, which
is its existing organization-wide assignment permission. Commercial plan
entitlements are evaluated before report generation, so a report cannot expose
a module unavailable in the tenant plan.

The default Administrator, QA Manager, Document Controller, and Auditor roles
receive both report permissions. Operators continue to use the role-scoped Dashboard.
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

The response contains overall KPIs, a comparison against the immediately
preceding period of equal duration, per-process status buckets, monthly creation
trends, and up to 20 critical or overdue records ordered for follow-up.

## Formal PDF export

`POST /api/v1/reports/operational/pdf` accepts `from`, `to`, and `locale`
(`es` or `en`). It generates a server-side PDF containing the executive reading,
KPIs and comparisons, trend, priorities, process detail, status distribution,
the organization and generating user, a report ID, and a SHA-256 fingerprint of
the underlying report data.

Every successful export appends a `QUALITY_REPORT_EXPORTED` security event with
the report ID, period, record and module counts, data fingerprint, and final PDF
SHA-256. The generated file is a traceable operational report; it does not claim
to be an electronically signed controlled record.

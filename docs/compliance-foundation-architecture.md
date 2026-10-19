# Qualyra Continuous Compliance — Architecture assessment and Phase 1 design

## Purpose

Qualyra remains a multi-tenant GMP/ISO quality management system. The compliance
layer is additive: it relates the controlled operational records already present
in Qualyra to configurable frameworks, requirements, controls, evidence and
findings. It does not replace the existing workflows and does not use an LLM as
the source of compliance truth.

## Current architecture found

### Backend

- NestJS modules mounted below `/api/v1` with controllers, application services
  and DTO validation.
- Prisma 7 over PostgreSQL. Tenant-owned operations execute inside
  `TenantUnitOfWork`, which sets `app.tenant_id` for the transaction.
- Tenant tables use composite tenant foreign keys and PostgreSQL RLS with both
  `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- Authentication uses revocable sessions and JWT access tokens. Authorization
  uses the existing permission catalogue, tenant roles and `PermissionsGuard`.
- Relevant changes are appended to the existing `security_events` audit trail.
- Commercial write restrictions are enforced centrally by the permission guard.
- Existing controlled modules: documents and revisions, training, deviations,
  CAPA, change control, audits and audit findings, quality risks, suppliers and
  SCAR, equipment/calibration/maintenance, complaints, recalls/field actions,
  product quality reviews and photographic evidence.
- Existing signatures preserve signer, session, meaning, authentication method,
  timestamp and record hash where a regulated decision requires them.

### Frontend

- React 18, Vite, React Router and Tailwind utility classes.
- A permission-aware `AdminShell` owns routable workspace sections, lazy-loaded
  feature views, responsive/collapsible navigation and contextual help.
- Server state is fetched through the typed shared API client; local component
  state is used for filters and forms. There is no second global state framework.
- Existing visual patterns use a dark module hero, metric cards, searchable list
  panels, detail/empty states, inline forms, toasts and unsaved-form protection.

## What is reusable

| Compliance need   | Existing Qualyra capability                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation  | `TenantUnitOfWork`, composite tenant keys and forced RLS                                                               |
| Access control    | Permission catalogue, roles, guard and commercial write policy                                                         |
| Audit trail       | Append-only `security_events` with actor and request metadata                                                          |
| Evidence sources  | Existing document, training, CAPA, audit, deviation, equipment, calibration, supplier, change-control and risk records |
| Finding ownership | Existing tenant users and role assignments                                                                             |
| Navigation        | Permission-filtered `AdminShell` and semantic module icons                                                             |
| Future automation | Existing modular application services can be queried through adapters rather than duplicated                           |

## Missing capabilities

- A configurable regulatory framework and hierarchical requirement catalogue.
- Tenant controls and many-to-many mappings between controls and requirements.
- Polymorphic, tenant-validated links from compliance targets to operational
  evidence without adding a database column for every future evidence type.
- A cross-module compliance finding lifecycle distinct from audit findings.
- Deterministic rule execution, evaluation runs and idempotent generated findings.
- Explainable readiness/category scoring and historical snapshots.
- A compliance workspace joining requirements, controls, evidence and findings.

## Phase 1 domain model

All Phase 1 records are tenant-owned. Even framework data is copied/versioned
inside a tenant. This deliberately avoids global/private catalogue exceptions in
RLS and lets an organization annotate or retire its own adopted version. A future
curated catalogue can publish importable templates without becoming a second
authorization domain.

- `ComplianceFramework`: code, name, version, jurisdiction, effective date and
  active state.
- `ComplianceRequirement`: hierarchical code/title/summary, mandatory flag,
  severity, configurable weight and sort order.
- `ComplianceControl`: organization control with category, owner, status and
  description.
- `ComplianceControlRequirement`: tenant-safe many-to-many mapping.
- `ComplianceEvidence`: polymorphic source type/id plus a stable human-readable
  reference; it can support a requirement, control or finding. Source existence
  is checked by an adapter against the corresponding tenant module.
- `ComplianceFinding`: requirement, optional control, severity, lifecycle,
  owner, deterministic/manual source metadata and resolution rationale.

No readiness score or AI output is persisted in Phase 1. Showing a score before
the rule engine and scoring policy exist would create unexplained, misleading
compliance data.

## Phase 1 API

- `GET /compliance/overview`
- `GET|POST /compliance/frameworks`
- `POST /compliance/frameworks/:frameworkId/requirements`
- `GET|POST /compliance/controls`
- `GET|POST /compliance/evidence`
- `GET|POST /compliance/findings`
- `PATCH /compliance/findings/:findingId/status`

The API uses the existing JWT and permission guards. Mutations append security
events; all queries execute inside the tenant unit of work.

## Permissions

- `compliance.read`
- `compliance.manage`
- `compliance.evaluate`
- `compliance.findings.manage`
- `compliance.frameworks.read`
- `compliance.frameworks.manage`

Administrators and QA Managers receive management permissions. Auditors and
Document Controllers receive read permissions. Operators do not receive broad
compliance visibility by default. Custom roles can use the same permission UI.

## Frontend Phase 1

The new `Compliance` workspace provides real foundation metrics, the framework
and requirement map, controls, evidence links and actionable open findings. It
does not display invented charts, trends or scores. The route and navigation are
permission-aware and follow the existing responsive shell and form patterns.

## Dependencies and phased delivery

1. **Foundation (this phase):** tenant schema, RLS, permissions, audit trail,
   CRUD/lifecycle API and initial workspace.
2. **Rule engine (delivered):** typed rule contract, tenant evaluation runs, idempotency,
   generated-finding reconciliation and first adapters (for example overdue CAPA
   and calibration).
3. **Audit readiness:** transparent scoring policy, explanations, categories,
   snapshots, trends and actionable overview.
4. **Operational integrations:** expand adapters across documents, training,
   deviations, audits, suppliers and other existing modules.
5. **Supplier compliance:** certificates, agreements, supplier audits and
   evaluation scoring on top of the supplier domain already present.
6. **AI Quality Officer:** structured retrieval over authorized requirements,
   evidence, findings and evaluations; citations and abstention are mandatory.

## Technical risks and controls

- **Polymorphic evidence integrity:** there is no portable SQL foreign key across
  many source tables. An application adapter validates source existence under the
  same tenant; RLS remains the final isolation boundary.
- **Framework copyright/versioning:** seed only codes and original summaries;
  never copy protected standard text. Framework versions are immutable references
  in future signed assessments.
- **Duplicate automated findings:** Phase 2 needs a stable rule key and source key
  before scheduled evaluation is enabled.
- **Misleading scores:** Phase 3 must return the weights, penalties and findings
  that explain every score.
- **Role overexposure:** broad compliance permissions are not granted to Operator;
  custom roles remain tenant-managed through existing RBAC.
- **Performance:** tenant/category/status indexes support the first read paths.
  Historical scoring is deferred to dedicated snapshots instead of recomputing
  every trend on page load.

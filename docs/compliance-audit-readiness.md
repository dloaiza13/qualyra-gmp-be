# Qualyra Continuous Compliance — Phase 3 Audit Readiness

## Outcome

Phase 3 turns the compliance foundation into an explainable readiness view. It
does not claim that an organization is certified or compliant. It answers four
operational questions from tenant-owned records:

1. What is the current readiness score, when a valid evaluation basis exists?
2. Which framework, category, requirement or finding reduced it?
3. What should the quality team correct first?
4. How did the measured state change between immutable snapshots?

An active framework with at least one requirement is the minimum evaluation
basis. Without it the API returns `overallScore: null` and
`status: NOT_ENOUGH_DATA`; the UI never substitutes a decorative percentage.

## Transparent calculation

The calculation starts at 100 and subtracts only persisted, tenant-scoped gaps:

- an `OPEN` or `IN_PROGRESS` finding, using its severity penalty;
- a mandatory requirement without an active mapped control;
- a mandatory mapped requirement without current direct or control evidence.

Each deduction is multiplied by the requirement weight and by optional
framework and category weights. Scores are clamped to 0–100. The response
includes the policy, every returned deduction, its source requirement and
finding, total deduction, coverage, findings, and framework/category
breakdowns. The default policy is:

| Condition                                      | Base deduction |
| ---------------------------------------------- | -------------: |
| Critical finding                               |             15 |
| Major finding                                  |              5 |
| Minor finding                                  |              2 |
| Observation                                    |            0.5 |
| Mandatory requirement without active control   |              5 |
| Mandatory requirement without current evidence |              2 |

Default status thresholds are `EXCELLENT >= 90`, `GOOD >= 75`,
`NEEDS_ATTENTION >= 50`, and `HIGH_RISK < 50`. A tenant may version these
values and weight a framework or category from 0.1 to 10. Requirement weights
remain part of the requirement definition.

`RESOLVED` findings do not affect the current score. `ACCEPTED_RISK` findings
remain explicitly counted but do not create an active deduction: accepting a
risk records a governed decision; it does not erase it from the dashboard.

## Historical evidence

A snapshot stores the score, coverage, finding counts, policy version and full
calculation payload as an immutable tenant record. It is created explicitly by
an authorized user or after a manual deterministic evaluation. Historical
charts read snapshots instead of silently recalculating the past with today's
policy or data.

Snapshots have forced PostgreSQL RLS and the runtime role can neither update nor
delete them. Policy changes and snapshot creation append security events.

## API and permissions

- `GET /compliance/readiness` — `compliance.read`
- `GET /compliance/readiness/policy` — `compliance.read`
- `PATCH /compliance/readiness/policy` — `compliance.manage`
- `GET /compliance/readiness/snapshots` — `compliance.read`
- `POST /compliance/readiness/snapshots` — `compliance.evaluate`

All calculations execute inside `TenantUnitOfWork`. Frameworks, requirements,
controls, current evidence and findings are queried under the same tenant
context. The UI exposes configuration only to compliance managers and snapshot
capture only to users allowed to evaluate.

## Deliberate limits

- The score is an internal prioritization aid, not certification or regulatory
  advice.
- Evidence validity uses the persisted `validUntil` value; future phases can add
  richer evidence-specific validity adapters.
- Phase 4 expands deterministic adapters across more operational modules.
- AI does not calculate, override or invent the score.

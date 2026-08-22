# Quality risk management

The quality-risk module implements a tenant-scoped FMEA workflow aligned with the risk-based principles of ICH Q9. It preserves the assessment context, initial scoring, assigned mitigations, residual scoring, and independent acceptance as one traceable record.

## Permissions

| Permission       | Capability                                                  |
| ---------------- | ----------------------------------------------------------- |
| `risks.read`     | Read assessments, scores, links, and signed evidence        |
| `risks.create`   | Create or cancel controlled FMEA assessments                |
| `risks.mitigate` | Complete and sign an assigned mitigation                    |
| `risks.review`   | Independently review and sign the residual-risk disposition |

Administrators and QA Managers receive all four permissions. Operators can read and complete mitigations assigned to them. Auditors receive organization-wide read-only access and do not sign the operational risk decision. Document Controllers do not receive this module by default. See `access-control-matrix.md` for the complete role model.

## API

| Method | Route                                           | Permission       | Purpose                                      |
| ------ | ----------------------------------------------- | ---------------- | -------------------------------------------- |
| `GET`  | `/quality-risks`                                | `risks.read`     | List and filter tenant assessments           |
| `GET`  | `/quality-risks/participants`                   | `risks.create`   | List active qualified participants           |
| `GET`  | `/quality-risks/references`                     | `risks.create`   | List same-tenant quality records for linking |
| `GET`  | `/quality-risks/:riskId`                        | `risks.read`     | Read the complete FMEA and evidence chain    |
| `POST` | `/quality-risks`                                | `risks.create`   | Create the immutable assessment plan         |
| `POST` | `/quality-risks/:riskId/items/:itemId/complete` | `risks.mitigate` | Sign mitigation and residual scoring         |
| `POST` | `/quality-risks/:riskId/review`                 | `risks.review`   | Sign residual-risk acceptance or rejection   |
| `POST` | `/quality-risks/:riskId/cancel`                 | `risks.create`   | Cancel before any mitigation is signed       |

Assessments receive annual `QRM-YYYY-NNNN` identifiers. Optional links to deviations, CAPA, change controls, and audits use composite tenant foreign keys.

## FMEA scoring and lifecycle

Each item records a failure mode, cause, effect, current controls, mitigation, assignee, and deadline. Severity, probability, and detectability use controlled values from 1 through 5. The service and database both enforce `RPN = S × P × D`.

The display classification is derived consistently:

| RPN    | Level    |
| ------ | -------- |
| 1–20   | Low      |
| 21–50  | Medium   |
| 51–80  | High     |
| 81–125 | Critical |

An assessment starts `OPEN`. Each assigned mitigator reauthenticates, attests, records objective implementation evidence, and signs the residual score. The final mitigation atomically advances the assessment to `PENDING_REVIEW`. Only the assigned reviewer—different from the creator, owner, and every mitigation signer—can sign `ACCEPT` or `NOT_ACCEPTABLE`. The resulting terminal state is `CLOSED` or `RESIDUAL_RISK_NOT_ACCEPTED`.

Residual scores are not required to be numerically lower than initial scores. New evidence may reveal greater risk, and the independent disposition must reflect that finding rather than suppress it.

## Evidence and database enforcement

Mitigation and review signatures bind the current user, active session, fixed meaning, password-reauthentication method, timestamp, source scores, evidence, and deterministic SHA-256 fingerprint. Failed reauthentication is also recorded as a security event.

All four quality-risk tables use forced PostgreSQL row-level security. Composite foreign keys prevent cross-tenant assignments and links. Database checks and triggers reject out-of-range scores, incorrect RPN values, incomplete signature tuples, changes to the approved plan, invalid transitions, non-independent reviews, and mutation or deletion of signed evidence. The runtime role cannot delete lifecycle records.

These controls are audit-ready building blocks; they do not by themselves establish GMP, ISO, FDA, ICH Q9, or 21 CFR Part 11 compliance. The deploying organization remains responsible for validation, procedures, identity governance, retention, trusted time, and intended-use assessment.

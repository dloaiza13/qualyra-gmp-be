# Supplier quality management

The supplier-quality module controls supplier registration, risk-based qualification, the approved supplier list, reassessment, and supplier corrective action requests (SCARs). Every record is tenant scoped and preserves independent decision evidence.

## Permissions

| Permission              | Capability                                                  |
| ----------------------- | ----------------------------------------------------------- |
| `suppliers.read`        | Read suppliers, assessments, decisions, and SCAR evidence   |
| `suppliers.create`      | Create controlled supplier master records                   |
| `suppliers.assess`      | Complete and sign qualification assessments                 |
| `suppliers.approve`     | Independently approve, conditionally approve, or disqualify |
| `suppliers.scar`        | Issue SCARs and sign received supplier responses            |
| `suppliers.review_scar` | Independently accept or request revision of SCAR responses  |

Administrators and QA Managers receive all permissions. Document Controllers can create, assess, and manage SCARs; Operators can assess and manage SCARs; Auditors can perform independent qualification and SCAR reviews. Custom roles remain unchanged.

## API

| Method | Route                                                               | Permission              | Purpose                                      |
| ------ | ------------------------------------------------------------------- | ----------------------- | -------------------------------------------- |
| `GET`  | `/suppliers`                                                        | `suppliers.read`        | List and filter tenant suppliers             |
| `GET`  | `/suppliers/participants`                                           | `suppliers.create`      | List eligible active participants            |
| `GET`  | `/suppliers/references`                                             | `suppliers.create`      | List same-tenant records available for links |
| `GET`  | `/suppliers/:supplierId`                                            | `suppliers.read`        | Read the complete supplier evidence chain    |
| `POST` | `/suppliers`                                                        | `suppliers.create`      | Register a controlled supplier               |
| `POST` | `/suppliers/:supplierId/qualifications`                             | `suppliers.assess`      | Sign an initial or follow-up assessment      |
| `POST` | `/suppliers/:supplierId/qualifications/:qualificationId/decision`   | `suppliers.approve`     | Sign the independent disposition             |
| `POST` | `/suppliers/:supplierId/scars`                                      | `suppliers.scar`        | Issue a supplier corrective action request   |
| `POST` | `/suppliers/:supplierId/scars/:scarId/responses`                    | `suppliers.scar`        | Sign a received supplier response            |
| `POST` | `/suppliers/:supplierId/scars/:scarId/responses/:responseId/review` | `suppliers.review_scar` | Sign acceptance or request revision          |

Suppliers receive annual `SUP-YYYY-NNNN` codes; corrective actions receive `SCAR-YYYY-NNNN` codes. Registration numbers are unique within an organization. Optional qualification links point to quality-risk assessments, while SCARs can reference CAPA, change controls, and audits through composite tenant foreign keys.

## Qualification and approved supplier list

The assigned quality owner scores quality system, compliance, delivery, and service from 1 to 5. The normalized overall score is `(sum of four scores) × 5`, producing 20–100. The first cycle must be `INITIAL`; later cycles may be `PERIODIC` or `EVENT_DRIVEN`. Conditional recommendations require documented conditions.

The assigned approver must be different from both the quality owner and record creator. Approval and conditional approval require a future reassessment date. A signed decision atomically completes the assessment and updates the supplier's approved-list status. Disqualification is terminal and removes the supplier from the approved list.

## SCAR response control

Only the quality owner can issue a SCAR for an approved or conditionally approved supplier. Received responses record root cause, immediate correction, corrective action, evidence reference, signer, active session, timestamp, signature meaning, and deterministic SHA-256 fingerprint.

The independent supplier approver accepts the response or requests revision. A revision reopens the SCAR without overwriting the rejected attempt; acceptance closes it. Each attempt and review therefore remains available as immutable audit evidence.

## Database enforcement

All seven supplier-quality tables use forced PostgreSQL row-level security. Database checks, partial unique indexes, and triggers enforce score calculations, one pending qualification and response, sequential cycles and attempts, signer responsibilities, independent decisions, valid lifecycle transitions, complete signature tuples, and immutability of controlled evidence. The runtime role cannot delete lifecycle records or update signed decisions.

These controls are audit-ready building blocks; they do not by themselves establish GMP or 21 CFR Part 11 compliance. The deploying organization remains responsible for validation, supplier procedures, identity governance, retention, trusted time, and intended-use assessment.

# Product quality complaints

Qualyra preserves the original product complaint intake and moves it through a controlled `REPORTED` → `UNDER_INVESTIGATION` → `PENDING_REVIEW` → `CLOSED` lifecycle. An invalid or duplicate record may only be cancelled before triage; the intake remains retained and auditable.

## Responsibilities

- `complaints.create` records the source communication, product, code, lot, country, dates, evidence reference, and potential patient-safety signal.
- `complaints.triage` classifies severity and regulatory status, records immediate action, and assigns an investigator and a different independent reviewer.
- The assigned user with `complaints.investigate` reauthenticates to sign the investigation. The record may link an existing deviation, CAPA, supplier, quality risk, or change control from the same tenant.
- The assigned user with `complaints.review` must be independent from the investigator and reauthenticates to sign the final disposition and close the complaint.
- `complaints.cancel` is limited to a justified pre-triage cancellation.

Signed investigation and decision records include signature meaning, authentication method, user, active session, timestamp, and a SHA-256 record hash. Database triggers prevent signed-record mutation and invalid lifecycle transitions. Forced PostgreSQL row-level security applies to every complaint table.

## Safety and regulatory boundary

`potentialSafetyEvent`, `regulatoryAssessment`, `recallAssessmentRequired`, and `recallActionRequired` are escalation controls. They do not implement pharmacovigilance, medical assessment, authority submission, recall execution, or country-specific reporting clocks. Organizations must connect those flags to qualified owners and validated procedures before production use.

## API

- `GET/POST /api/v1/complaints`
- `GET /api/v1/complaints/participants`
- `GET /api/v1/complaints/references`
- `GET /api/v1/complaints/:complaintId`
- `POST /api/v1/complaints/:complaintId/triage`
- `POST /api/v1/complaints/:complaintId/investigation`
- `POST /api/v1/complaints/:complaintId/decision`
- `POST /api/v1/complaints/:complaintId/cancellation`

The OpenAPI document served by the application is the authoritative request and response contract.

# Periodic product quality reviews (PQR/APR)

Qualyra controls the periodic or annual product review as a product-and-period-specific record. The workflow consolidates manually verified manufacturing data with an automatically captured trend snapshot from complaints, recalls, and the quality processes linked through complaint investigations.

## Lifecycle

1. A permitted user creates an immutable scope with product identity, marketing authorization, review period, completion target, and independent approver.
2. A different authorized preparer consolidates batch, OOS, stability, validation, regulatory, benefit-risk, and recommendation evidence.
3. Password reauthentication binds the assessment to the active user and session. At that moment, Qualyra captures the current trend snapshot and its SHA-256 record hash.
4. The assigned independent approver signs either `APPROVE` or `REQUIRE_FOLLOW_UP`, including a rationale, controlled follow-up reference, and next-review date.
5. An incorrect draft may be cancelled before the signed assessment. Signed and terminal evidence cannot be edited or deleted through the runtime role.

## Trend snapshot

The snapshot compares the selected period with the immediately preceding period of equal duration. It includes:

- current and previous complaint and recall counts;
- substantiated, high/critical, and reportable complaints;
- closed recalls;
- distinct deviations, CAPAs, suppliers, quality risks, and change controls linked by complaint investigations;
- monthly complaint and recall buckets.

The snapshot is evidence, not a statistical quality-control conclusion. A qualified reviewer must interpret exposure, production volume, reporting changes, seasonality, and applicable registered commitments.

## Security and data integrity

- All tables carry `tenant_id`, forced PostgreSQL RLS, tenant-scoped keys, and runtime grants.
- Product/period scope and assigned approver are immutable after intake.
- Assessment and approval require an active session and password reauthentication.
- Database triggers enforce lifecycle order, independent approval, and append-only signed records.
- Security events record creation, signatures, cancellation, and failed reauthentication.

## Deliberate boundaries

Qualyra does not calculate process capability, determine product release, establish regulatory conclusions, or create CAPA/change-control records automatically. Those decisions require approved procedures, qualified personnel, source-data verification, and the organization's validated operating context.

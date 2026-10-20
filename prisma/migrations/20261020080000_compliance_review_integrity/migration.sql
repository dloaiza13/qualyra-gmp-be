-- Control mappings are editable only through the audited compliance service.
GRANT DELETE ON TABLE "compliance_control_requirements" TO qualyra_runtime;

ALTER TABLE "compliance_score_snapshots"
  DROP CONSTRAINT "compliance_score_snapshots_score_check",
  ADD CONSTRAINT "compliance_score_snapshots_score_check" CHECK (
    ("status" = 'NOT_ENOUGH_DATA' AND "overall_score" IS NULL) OR
    ("status" <> 'NOT_ENOUGH_DATA' AND "overall_score" IS NOT NULL AND "overall_score" BETWEEN 0 AND 100)
  );

ALTER TABLE "compliance_readiness_policies"
  ADD CONSTRAINT "compliance_readiness_policies_penalties_max_check" CHECK (
    "critical_penalty" <= 100 AND "major_penalty" <= 100 AND
    "minor_penalty" <= 100 AND "observation_penalty" <= 100 AND
    "unmapped_requirement_penalty" <= 100 AND "missing_evidence_penalty" <= 100
  );

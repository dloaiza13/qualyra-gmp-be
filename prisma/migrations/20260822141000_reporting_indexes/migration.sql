CREATE INDEX "documents_reporting_created_idx"
  ON "documents" ("tenant_id", "created_at");

CREATE INDEX "training_assignments_reporting_created_idx"
  ON "training_assignments" ("tenant_id", "created_at");

CREATE INDEX "deviations_reporting_created_idx"
  ON "deviations" ("tenant_id", "created_at");

CREATE INDEX "quality_risks_reporting_created_idx"
  ON "quality_risk_assessments" ("tenant_id", "created_at");

CREATE INDEX "suppliers_reporting_created_idx"
  ON "suppliers" ("tenant_id", "created_at");

CREATE INDEX "equipment_reporting_created_idx"
  ON "equipment" ("tenant_id", "created_at");

CREATE INDEX "product_complaints_reporting_created_idx"
  ON "product_complaints" ("tenant_id", "created_at");

CREATE INDEX "product_recalls_reporting_created_idx"
  ON "product_recalls" ("tenant_id", "created_at");

CREATE INDEX "product_reviews_reporting_created_idx"
  ON "product_quality_reviews" ("tenant_id", "created_at");

-- Tie every workflow version to the same document identifier at the database layer.
ALTER TABLE "document_workflows"
  DROP CONSTRAINT "document_workflows_tenant_id_document_version_id_fkey";

CREATE UNIQUE INDEX "document_versions_tenant_document_id_id_key"
  ON "document_versions"("tenant_id", "document_id", "id");

CREATE UNIQUE INDEX "document_workflows_tenant_document_version_id_key"
  ON "document_workflows"("tenant_id", "document_id", "document_version_id");

ALTER TABLE "document_workflows"
  ADD CONSTRAINT "document_workflows_tenant_id_document_id_document_version_id_fkey"
  FOREIGN KEY ("tenant_id", "document_id", "document_version_id")
  REFERENCES "document_versions"("tenant_id", "document_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the shared signature enum constrained to the record type that owns it.
ALTER TABLE "document_releases"
  ADD CONSTRAINT "document_releases_meaning_check"
  CHECK ("meaning" = 'DOCUMENT_RELEASE');

ALTER TABLE "document_obsolescences"
  ADD CONSTRAINT "document_obsolescences_meaning_check"
  CHECK ("meaning" = 'DOCUMENT_OBSOLESCENCE');

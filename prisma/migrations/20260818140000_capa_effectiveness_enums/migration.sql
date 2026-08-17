-- PostgreSQL requires new enum values to be committed before they are used by
-- constraints or persisted records in the following migration.
ALTER TYPE "DeviationStatus" ADD VALUE 'CLOSED';
ALTER TYPE "CapaSignatureMeaning" ADD VALUE 'EFFECTIVENESS_VERIFICATION';

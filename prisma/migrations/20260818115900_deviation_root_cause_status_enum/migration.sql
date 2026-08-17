-- PostgreSQL requires a new enum value to be committed before constraints use it.
ALTER TYPE "DeviationStatus" ADD VALUE 'INVESTIGATION_COMPLETED' AFTER 'UNDER_INVESTIGATION';

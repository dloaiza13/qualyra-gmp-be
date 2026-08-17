-- PostgreSQL requires a newly added enum value to be committed before it can
-- be used by the following migration.
ALTER TYPE "CapaSignatureMeaning" ADD VALUE 'ACTION_EXTENSION_APPROVAL';

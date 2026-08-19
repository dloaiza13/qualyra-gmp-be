-- CreateEnum
CREATE TYPE "EquipmentCategory" AS ENUM ('PRODUCTION', 'LABORATORY', 'UTILITY', 'MEASUREMENT', 'COMPUTERIZED_SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "EquipmentCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED');

-- CreateEnum
CREATE TYPE "EquipmentServiceStatus" AS ENUM ('PENDING_REVIEW', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CalibrationResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVE', 'CORRECTIVE');

-- CreateEnum
CREATE TYPE "MaintenanceResult" AS ENUM ('SATISFACTORY', 'UNSATISFACTORY');

-- CreateEnum
CREATE TYPE "EquipmentReviewDecision" AS ENUM ('ACCEPT', 'REJECT');

-- CreateEnum
CREATE TYPE "EquipmentSignatureMeaning" AS ENUM ('CALIBRATION_COMPLETION', 'CALIBRATION_REVIEW', 'MAINTENANCE_COMPLETION', 'MAINTENANCE_REVIEW', 'EQUIPMENT_RETIREMENT');

-- CreateEnum
CREATE TYPE "EquipmentAuthenticationMethod" AS ENUM ('PASSWORD_REAUTHENTICATION');

-- CreateTable
CREATE TABLE "equipment_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equipment_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(25) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "category" "EquipmentCategory" NOT NULL,
    "criticality" "EquipmentCriticality" NOT NULL,
    "manufacturer" VARCHAR(200) NOT NULL,
    "model" VARCHAR(150) NOT NULL,
    "serial_number" VARCHAR(150) NOT NULL,
    "location" VARCHAR(300) NOT NULL,
    "process_area" VARCHAR(150) NOT NULL,
    "intended_use" VARCHAR(3000) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "verifier_user_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "calibration_required" BOOLEAN NOT NULL DEFAULT false,
    "calibration_interval_days" INTEGER,
    "next_calibration_at" TIMESTAMPTZ(3),
    "maintenance_required" BOOLEAN NOT NULL DEFAULT true,
    "maintenance_interval_days" INTEGER,
    "next_maintenance_at" TIMESTAMPTZ(3),
    "status" "EquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "out_of_service_reason" VARCHAR(1000),
    "retired_by_user_id" UUID,
    "retirement_session_id" UUID,
    "retirement_reason" VARCHAR(1000),
    "retired_at" TIMESTAMPTZ(3),
    "retirement_record_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_calibrations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "due_at_snapshot" TIMESTAMPTZ(3),
    "result" "CalibrationResult" NOT NULL,
    "certificate_reference" VARCHAR(1000) NOT NULL,
    "standard_reference" VARCHAR(1000) NOT NULL,
    "readings_summary" VARCHAR(5000) NOT NULL,
    "performed_by_user_id" UUID NOT NULL,
    "completion_session_id" UUID NOT NULL,
    "meaning" "EquipmentSignatureMeaning" NOT NULL DEFAULT 'CALIBRATION_COMPLETION',
    "authentication_method" "EquipmentAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "performed_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "status" "EquipmentServiceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_calibrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_calibration_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "calibration_id" UUID NOT NULL,
    "decision" "EquipmentReviewDecision" NOT NULL,
    "rationale" VARCHAR(3000) NOT NULL,
    "reviewed_by_user_id" UUID NOT NULL,
    "review_session_id" UUID NOT NULL,
    "meaning" "EquipmentSignatureMeaning" NOT NULL DEFAULT 'CALIBRATION_REVIEW',
    "authentication_method" "EquipmentAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_calibration_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_maintenances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "due_at_snapshot" TIMESTAMPTZ(3),
    "work_order_reference" VARCHAR(1000) NOT NULL,
    "work_performed" VARCHAR(5000) NOT NULL,
    "parts_and_materials" VARCHAR(3000) NOT NULL,
    "evidence_reference" VARCHAR(3000) NOT NULL,
    "result" "MaintenanceResult" NOT NULL,
    "performed_by_user_id" UUID NOT NULL,
    "completion_session_id" UUID NOT NULL,
    "meaning" "EquipmentSignatureMeaning" NOT NULL DEFAULT 'MAINTENANCE_COMPLETION',
    "authentication_method" "EquipmentAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "performed_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "status" "EquipmentServiceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_maintenance_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "maintenance_id" UUID NOT NULL,
    "decision" "EquipmentReviewDecision" NOT NULL,
    "rationale" VARCHAR(3000) NOT NULL,
    "reviewed_by_user_id" UUID NOT NULL,
    "review_session_id" UUID NOT NULL,
    "meaning" "EquipmentSignatureMeaning" NOT NULL DEFAULT 'MAINTENANCE_REVIEW',
    "authentication_method" "EquipmentAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD_REAUTHENTICATION',
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "record_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equipment_maintenance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_calibration_due_idx" ON "equipment"("tenant_id", "status", "next_calibration_at");

-- CreateIndex
CREATE INDEX "equipment_maintenance_due_idx" ON "equipment"("tenant_id", "status", "next_maintenance_at");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_tenant_id_id_key" ON "equipment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_tenant_code_key" ON "equipment"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_tenant_serial_key" ON "equipment"("tenant_id", "serial_number");

-- CreateIndex
CREATE INDEX "equipment_calibrations_status_idx" ON "equipment_calibrations"("tenant_id", "equipment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_calibrations_tenant_id_id_key" ON "equipment_calibrations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_calibrations_cycle_key" ON "equipment_calibrations"("tenant_id", "equipment_id", "cycle_number");

-- CreateIndex
CREATE UNIQUE INDEX "calibration_reviews_tenant_id_id_key" ON "equipment_calibration_reviews"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "calibration_reviews_calibration_key" ON "equipment_calibration_reviews"("tenant_id", "calibration_id");

-- CreateIndex
CREATE INDEX "equipment_maintenances_status_idx" ON "equipment_maintenances"("tenant_id", "equipment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_maintenances_tenant_id_id_key" ON "equipment_maintenances"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_maintenances_cycle_key" ON "equipment_maintenances"("tenant_id", "equipment_id", "cycle_number");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_reviews_tenant_id_id_key" ON "equipment_maintenance_reviews"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_reviews_maintenance_key" ON "equipment_maintenance_reviews"("tenant_id", "maintenance_id");

-- AddForeignKey
ALTER TABLE "equipment_sequences" ADD CONSTRAINT "equipment_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_owner_user_id_fkey" FOREIGN KEY ("tenant_id", "owner_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_verifier_user_id_fkey" FOREIGN KEY ("tenant_id", "verifier_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_created_by_user_id_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_retirer_fkey" FOREIGN KEY ("tenant_id", "retired_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_retirement_session_fkey" FOREIGN KEY ("tenant_id", "retired_by_user_id", "retirement_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibrations" ADD CONSTRAINT "equipment_calibrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibrations" ADD CONSTRAINT "equipment_calibrations_tenant_id_equipment_id_fkey" FOREIGN KEY ("tenant_id", "equipment_id") REFERENCES "equipment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibrations" ADD CONSTRAINT "calibration_performer_fkey" FOREIGN KEY ("tenant_id", "performed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibrations" ADD CONSTRAINT "calibration_completion_session_fkey" FOREIGN KEY ("tenant_id", "performed_by_user_id", "completion_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibration_reviews" ADD CONSTRAINT "equipment_calibration_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibration_reviews" ADD CONSTRAINT "equipment_calibration_reviews_tenant_id_calibration_id_fkey" FOREIGN KEY ("tenant_id", "calibration_id") REFERENCES "equipment_calibrations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibration_reviews" ADD CONSTRAINT "calibration_reviewer_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_calibration_reviews" ADD CONSTRAINT "calibration_review_session_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id", "review_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenances" ADD CONSTRAINT "equipment_maintenances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenances" ADD CONSTRAINT "equipment_maintenances_tenant_id_equipment_id_fkey" FOREIGN KEY ("tenant_id", "equipment_id") REFERENCES "equipment"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenances" ADD CONSTRAINT "maintenance_performer_fkey" FOREIGN KEY ("tenant_id", "performed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenances" ADD CONSTRAINT "maintenance_completion_session_fkey" FOREIGN KEY ("tenant_id", "performed_by_user_id", "completion_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance_reviews" ADD CONSTRAINT "equipment_maintenance_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance_reviews" ADD CONSTRAINT "equipment_maintenance_reviews_tenant_id_maintenance_id_fkey" FOREIGN KEY ("tenant_id", "maintenance_id") REFERENCES "equipment_maintenances"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance_reviews" ADD CONSTRAINT "maintenance_reviewer_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_maintenance_reviews" ADD CONSTRAINT "maintenance_review_session_fkey" FOREIGN KEY ("tenant_id", "reviewed_by_user_id", "review_session_id") REFERENCES "sessions"("tenant_id", "user_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- GMP asset-management invariants
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_independence_check"
  CHECK ("owner_user_id" <> "verifier_user_id" AND "created_by_user_id" <> "verifier_user_id");
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_calibration_plan_check" CHECK (
  ("calibration_required" AND "calibration_interval_days" BETWEEN 1 AND 3650 AND "next_calibration_at" IS NOT NULL)
  OR (NOT "calibration_required" AND "calibration_interval_days" IS NULL AND "next_calibration_at" IS NULL)
);
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_maintenance_plan_check" CHECK (
  ("maintenance_required" AND "maintenance_interval_days" BETWEEN 1 AND 3650 AND "next_maintenance_at" IS NOT NULL)
  OR (NOT "maintenance_required" AND "maintenance_interval_days" IS NULL AND "next_maintenance_at" IS NULL)
);
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_retirement_tuple_check" CHECK (
  ("status" <> 'RETIRED' AND "retired_by_user_id" IS NULL AND "retirement_session_id" IS NULL
    AND "retirement_reason" IS NULL AND "retired_at" IS NULL AND "retirement_record_hash" IS NULL)
  OR ("status" = 'RETIRED' AND "retired_by_user_id" IS NOT NULL AND "retirement_session_id" IS NOT NULL
    AND "retirement_reason" IS NOT NULL AND "retired_at" IS NOT NULL AND "retirement_record_hash" IS NOT NULL)
);
ALTER TABLE "equipment_calibrations" ADD CONSTRAINT "equipment_calibrations_cycle_check" CHECK ("cycle_number" > 0);
ALTER TABLE "equipment_maintenances" ADD CONSTRAINT "equipment_maintenances_cycle_check" CHECK ("cycle_number" > 0);
CREATE UNIQUE INDEX "equipment_calibrations_one_pending_idx" ON "equipment_calibrations" ("tenant_id", "equipment_id") WHERE "status" = 'PENDING_REVIEW';
CREATE UNIQUE INDEX "equipment_maintenances_one_pending_idx" ON "equipment_maintenances" ("tenant_id", "equipment_id") WHERE "status" = 'PENDING_REVIEW';

CREATE FUNCTION public.guard_equipment_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.name, NEW.category, NEW.criticality, NEW.manufacturer,
         NEW.model, NEW.serial_number, NEW.location, NEW.process_area, NEW.intended_use,
         NEW.owner_user_id, NEW.verifier_user_id, NEW.created_by_user_id,
         NEW.calibration_required, NEW.calibration_interval_days,
         NEW.maintenance_required, NEW.maintenance_interval_days, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.name, OLD.category, OLD.criticality, OLD.manufacturer,
         OLD.model, OLD.serial_number, OLD.location, OLD.process_area, OLD.intended_use,
         OLD.owner_user_id, OLD.verifier_user_id, OLD.created_by_user_id,
         OLD.calibration_required, OLD.calibration_interval_days,
         OLD.maintenance_required, OLD.maintenance_interval_days, OLD.created_at) THEN
    RAISE EXCEPTION 'The controlled equipment master record is immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'RETIRED' THEN
    RAISE EXCEPTION 'Retired equipment is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'RETIRED' THEN
    IF NEW.retired_by_user_id <> NEW.verifier_user_id OR EXISTS (
      SELECT 1 FROM public.equipment_calibrations c WHERE c.tenant_id = NEW.tenant_id AND c.equipment_id = NEW.id AND c.status = 'PENDING_REVIEW'
      UNION ALL
      SELECT 1 FROM public.equipment_maintenances m WHERE m.tenant_id = NEW.tenant_id AND m.equipment_id = NEW.id AND m.status = 'PENDING_REVIEW'
    ) THEN
      RAISE EXCEPTION 'Only the independent verifier may retire equipment without pending reviews.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'ACTIVE' AND (
    (NEW.calibration_required AND (NEW.next_calibration_at IS NULL OR NEW.next_calibration_at <= CURRENT_TIMESTAMP))
    OR (NEW.maintenance_required AND (NEW.next_maintenance_at IS NULL OR NEW.next_maintenance_at <= CURRENT_TIMESTAMP))
    OR EXISTS (
      SELECT 1 FROM public.equipment_calibrations c WHERE c.tenant_id = NEW.tenant_id AND c.equipment_id = NEW.id AND c.status = 'PENDING_REVIEW'
      UNION ALL
      SELECT 1 FROM public.equipment_maintenances m WHERE m.tenant_id = NEW.tenant_id AND m.equipment_id = NEW.id AND m.status = 'PENDING_REVIEW'
    )
  ) THEN
    RAISE EXCEPTION 'Equipment cannot be active with overdue or pending required service.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'OUT_OF_SERVICE' AND NEW.out_of_service_reason IS NULL THEN
    RAISE EXCEPTION 'Out-of-service equipment requires a documented reason.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_calibration_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_cycle INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(c.cycle_number), 0) + 1 INTO expected_cycle
    FROM public.equipment_calibrations c WHERE c.tenant_id = NEW.tenant_id AND c.equipment_id = NEW.equipment_id;
    IF NEW.cycle_number <> expected_cycle OR NOT EXISTS (
      SELECT 1 FROM public.equipment e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.equipment_id
        AND e.status <> 'RETIRED' AND e.calibration_required AND e.owner_user_id = NEW.performed_by_user_id
        AND e.verifier_user_id <> NEW.performed_by_user_id
    ) OR EXISTS (
      SELECT 1 FROM public.equipment_maintenances m WHERE m.tenant_id = NEW.tenant_id AND m.equipment_id = NEW.equipment_id AND m.status = 'PENDING_REVIEW'
    ) THEN
      RAISE EXCEPTION 'Invalid signed calibration record.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.equipment_id, NEW.cycle_number, NEW.due_at_snapshot, NEW.result,
         NEW.certificate_reference, NEW.standard_reference, NEW.readings_summary,
         NEW.performed_by_user_id, NEW.completion_session_id, NEW.meaning,
         NEW.authentication_method, NEW.performed_at, NEW.record_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.equipment_id, OLD.cycle_number, OLD.due_at_snapshot, OLD.result,
         OLD.certificate_reference, OLD.standard_reference, OLD.readings_summary,
         OLD.performed_by_user_id, OLD.completion_session_id, OLD.meaning,
         OLD.authentication_method, OLD.performed_at, OLD.record_hash, OLD.created_at)
    OR OLD.status <> 'PENDING_REVIEW' OR NEW.status NOT IN ('COMPLETED', 'REJECTED')
    OR NOT EXISTS (SELECT 1 FROM public.equipment_calibration_reviews r WHERE r.tenant_id = NEW.tenant_id AND r.calibration_id = NEW.id) THEN
    RAISE EXCEPTION 'Signed calibration records are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_calibration_review_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.equipment_calibrations c
    JOIN public.equipment e ON e.tenant_id = c.tenant_id AND e.id = c.equipment_id
    WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.calibration_id AND c.status = 'PENDING_REVIEW'
      AND e.verifier_user_id = NEW.reviewed_by_user_id AND c.performed_by_user_id <> NEW.reviewed_by_user_id
  ) THEN RAISE EXCEPTION 'Only the independent verifier may review calibration.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_maintenance_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_cycle INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(m.cycle_number), 0) + 1 INTO expected_cycle
    FROM public.equipment_maintenances m WHERE m.tenant_id = NEW.tenant_id AND m.equipment_id = NEW.equipment_id;
    IF NEW.cycle_number <> expected_cycle OR NOT EXISTS (
      SELECT 1 FROM public.equipment e WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.equipment_id
        AND e.status <> 'RETIRED' AND e.owner_user_id = NEW.performed_by_user_id
        AND e.verifier_user_id <> NEW.performed_by_user_id
        AND (NEW.type = 'CORRECTIVE' OR e.maintenance_required)
    ) OR EXISTS (
      SELECT 1 FROM public.equipment_calibrations c WHERE c.tenant_id = NEW.tenant_id AND c.equipment_id = NEW.equipment_id AND c.status = 'PENDING_REVIEW'
    ) THEN
      RAISE EXCEPTION 'Invalid signed maintenance record.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.equipment_id, NEW.cycle_number, NEW.type, NEW.due_at_snapshot,
         NEW.work_order_reference, NEW.work_performed, NEW.parts_and_materials,
         NEW.evidence_reference, NEW.result, NEW.performed_by_user_id,
         NEW.completion_session_id, NEW.meaning, NEW.authentication_method,
         NEW.performed_at, NEW.record_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.equipment_id, OLD.cycle_number, OLD.type, OLD.due_at_snapshot,
         OLD.work_order_reference, OLD.work_performed, OLD.parts_and_materials,
         OLD.evidence_reference, OLD.result, OLD.performed_by_user_id,
         OLD.completion_session_id, OLD.meaning, OLD.authentication_method,
         OLD.performed_at, OLD.record_hash, OLD.created_at)
    OR OLD.status <> 'PENDING_REVIEW' OR NEW.status NOT IN ('COMPLETED', 'REJECTED')
    OR NOT EXISTS (SELECT 1 FROM public.equipment_maintenance_reviews r WHERE r.tenant_id = NEW.tenant_id AND r.maintenance_id = NEW.id) THEN
    RAISE EXCEPTION 'Signed maintenance records are immutable.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_maintenance_review_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.equipment_maintenances m
    JOIN public.equipment e ON e.tenant_id = m.tenant_id AND e.id = m.equipment_id
    WHERE m.tenant_id = NEW.tenant_id AND m.id = NEW.maintenance_id AND m.status = 'PENDING_REVIEW'
      AND e.verifier_user_id = NEW.reviewed_by_user_id AND m.performed_by_user_id <> NEW.reviewed_by_user_id
  ) THEN RAISE EXCEPTION 'Only the independent verifier may review maintenance.' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_equipment_record_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Controlled equipment records cannot be changed or deleted.' USING ERRCODE = '55000'; END;
$$;

CREATE TRIGGER equipment_mutation_guard BEFORE UPDATE ON "equipment" FOR EACH ROW EXECUTE FUNCTION public.guard_equipment_mutation();
CREATE TRIGGER equipment_delete_guard BEFORE DELETE ON "equipment" FOR EACH ROW EXECUTE FUNCTION public.prevent_equipment_record_mutation();
CREATE TRIGGER calibrations_mutation_guard BEFORE INSERT OR UPDATE ON "equipment_calibrations" FOR EACH ROW EXECUTE FUNCTION public.guard_calibration_mutation();
CREATE TRIGGER calibrations_delete_guard BEFORE DELETE ON "equipment_calibrations" FOR EACH ROW EXECUTE FUNCTION public.prevent_equipment_record_mutation();
CREATE TRIGGER calibration_reviews_insert_guard BEFORE INSERT ON "equipment_calibration_reviews" FOR EACH ROW EXECUTE FUNCTION public.guard_calibration_review_insert();
CREATE TRIGGER calibration_reviews_immutable BEFORE UPDATE OR DELETE ON "equipment_calibration_reviews" FOR EACH ROW EXECUTE FUNCTION public.prevent_equipment_record_mutation();
CREATE TRIGGER maintenances_mutation_guard BEFORE INSERT OR UPDATE ON "equipment_maintenances" FOR EACH ROW EXECUTE FUNCTION public.guard_maintenance_mutation();
CREATE TRIGGER maintenances_delete_guard BEFORE DELETE ON "equipment_maintenances" FOR EACH ROW EXECUTE FUNCTION public.prevent_equipment_record_mutation();
CREATE TRIGGER maintenance_reviews_insert_guard BEFORE INSERT ON "equipment_maintenance_reviews" FOR EACH ROW EXECUTE FUNCTION public.guard_maintenance_review_insert();
CREATE TRIGGER maintenance_reviews_immutable BEFORE UPDATE OR DELETE ON "equipment_maintenance_reviews" FOR EACH ROW EXECUTE FUNCTION public.prevent_equipment_record_mutation();

REVOKE ALL ON FUNCTION public.guard_equipment_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_calibration_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_calibration_review_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_maintenance_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_maintenance_review_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_equipment_record_mutation() FROM PUBLIC;

ALTER TABLE "equipment_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_sequences" FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment_calibrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_calibrations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment_calibration_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_calibration_reviews" FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment_maintenances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_maintenances" FORCE ROW LEVEL SECURITY;
ALTER TABLE "equipment_maintenance_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "equipment_maintenance_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "equipment_sequences" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "equipment" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "equipment_calibrations" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "equipment_calibration_reviews" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "equipment_maintenances" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON "equipment_maintenance_reviews" USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "equipment_sequences", "equipment", "equipment_calibrations", "equipment_maintenances" TO qualyra_runtime;
GRANT SELECT, INSERT ON TABLE "equipment_calibration_reviews", "equipment_maintenance_reviews" TO qualyra_runtime;
REVOKE DELETE ON TABLE "equipment_sequences", "equipment", "equipment_calibrations", "equipment_calibration_reviews", "equipment_maintenances", "equipment_maintenance_reviews" FROM qualyra_runtime;
REVOKE UPDATE ON TABLE "equipment_calibration_reviews", "equipment_maintenance_reviews" FROM qualyra_runtime;

INSERT INTO "permissions" ("id", "code", "description") VALUES
  (gen_random_uuid(), 'equipment.read', 'View GMP equipment, calibration, and maintenance evidence.'),
  (gen_random_uuid(), 'equipment.create', 'Create controlled GMP equipment master records.'),
  (gen_random_uuid(), 'equipment.calibrate', 'Complete and sign equipment calibration records.'),
  (gen_random_uuid(), 'equipment.maintain', 'Complete and sign equipment maintenance records.'),
  (gen_random_uuid(), 'equipment.verify', 'Independently review calibration and maintenance records.'),
  (gen_random_uuid(), 'equipment.retire', 'Independently sign equipment retirement.')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

DO $$
DECLARE tenant_record RECORD;
BEGIN
  FOR tenant_record IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', tenant_record.id::text, true);
    INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_id")
    SELECT tenant_record.id, role.id, permission.id
    FROM "roles" role
    JOIN (VALUES
      ('Administrator', 'equipment.read'), ('Administrator', 'equipment.create'), ('Administrator', 'equipment.calibrate'), ('Administrator', 'equipment.maintain'), ('Administrator', 'equipment.verify'), ('Administrator', 'equipment.retire'),
      ('QA Manager', 'equipment.read'), ('QA Manager', 'equipment.create'), ('QA Manager', 'equipment.calibrate'), ('QA Manager', 'equipment.maintain'), ('QA Manager', 'equipment.verify'), ('QA Manager', 'equipment.retire'),
      ('Document Controller', 'equipment.read'), ('Document Controller', 'equipment.create'), ('Document Controller', 'equipment.calibrate'), ('Document Controller', 'equipment.maintain'),
      ('Operator', 'equipment.read'), ('Operator', 'equipment.calibrate'), ('Operator', 'equipment.maintain'),
      ('Auditor', 'equipment.read'), ('Auditor', 'equipment.verify'), ('Auditor', 'equipment.retire')
    ) AS grant_map(role_name, permission_code) ON grant_map.role_name = role.name
    JOIN "permissions" permission ON permission.code = grant_map.permission_code
    WHERE role.tenant_id = tenant_record.id AND role.is_system = true
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;

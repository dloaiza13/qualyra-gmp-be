CREATE OR REPLACE FUNCTION public.guard_quality_risk_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.title, NEW.category, NEW.method, NEW.process_area,
         NEW.scope, NEW.risk_statement, NEW.owner_user_id, NEW.reviewer_user_id,
         NEW.created_by_user_id, NEW.target_review_at, NEW.deviation_id, NEW.capa_id,
         NEW.change_control_id, NEW.audit_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.title, OLD.category, OLD.method, OLD.process_area,
         OLD.scope, OLD.risk_statement, OLD.owner_user_id, OLD.reviewer_user_id,
         OLD.created_by_user_id, OLD.target_review_at, OLD.deviation_id, OLD.capa_id,
         OLD.change_control_id, OLD.audit_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The approved quality risk plan is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'OPEN' AND NEW.status IN ('PENDING_REVIEW', 'CANCELLED')) OR
    (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('CLOSED', 'RESIDUAL_RISK_NOT_ACCEPTED'))
  ) THEN
    RAISE EXCEPTION 'Invalid quality risk lifecycle transition.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'CANCELLED' AND EXISTS (
    SELECT 1 FROM public.quality_risk_items item
    WHERE item.tenant_id = NEW.tenant_id AND item.risk_id = NEW.id AND item.status = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'An assessment with signed mitigations cannot be cancelled.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'PENDING_REVIEW' AND EXISTS (
    SELECT 1 FROM public.quality_risk_items item
    WHERE item.tenant_id = NEW.tenant_id AND item.risk_id = NEW.id AND item.status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Every mitigation must be completed before residual risk review.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'PENDING_REVIEW' AND NOT EXISTS (
    SELECT 1 FROM public.quality_risk_items item
    WHERE item.tenant_id = NEW.tenant_id AND item.risk_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A quality risk assessment requires at least one FMEA item.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('CLOSED', 'RESIDUAL_RISK_NOT_ACCEPTED') AND NOT EXISTS (
    SELECT 1 FROM public.quality_risk_reviews review
    WHERE review.tenant_id = NEW.tenant_id AND review.risk_id = NEW.id
      AND ((NEW.status = 'CLOSED' AND review.decision = 'ACCEPT')
        OR (NEW.status = 'RESIDUAL_RISK_NOT_ACCEPTED' AND review.decision = 'NOT_ACCEPTABLE'))
  ) THEN
    RAISE EXCEPTION 'A matching signed residual risk review is required.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_quality_risk_transition() FROM PUBLIC;

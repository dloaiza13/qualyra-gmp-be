CREATE OR REPLACE FUNCTION public.guard_audit_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.tenant_id, NEW.code, NEW.title, NEW.type, NEW.scope, NEW.objectives, NEW.criteria,
         NEW.scheduled_start_at, NEW.scheduled_end_at, NEW.lead_auditor_user_id, NEW.reviewer_user_id,
         NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.code, OLD.title, OLD.type, OLD.scope, OLD.objectives, OLD.criteria,
         OLD.scheduled_start_at, OLD.scheduled_end_at, OLD.lead_auditor_user_id, OLD.reviewer_user_id,
         OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The approved audit plan is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'PLANNED' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED')) OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('FOLLOW_UP', 'READY_FOR_CLOSURE')) OR
    (OLD.status = 'FOLLOW_UP' AND NEW.status = 'READY_FOR_CLOSURE') OR
    (OLD.status = 'READY_FOR_CLOSURE' AND NEW.status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'Invalid audit lifecycle transition.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'IN_PROGRESS' AND NEW.started_at IS NULL THEN
    RAISE EXCEPTION 'Audit execution requires a start timestamp.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'IN_PROGRESS' AND NEW.status IN ('FOLLOW_UP', 'READY_FOR_CLOSURE') AND NOT EXISTS (
    SELECT 1 FROM public.audit_reports report
    WHERE report.tenant_id = NEW.tenant_id AND report.audit_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Audit execution cannot finish without a signed report.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'FOLLOW_UP' AND NOT EXISTS (
    SELECT 1 FROM public.audit_findings finding
    WHERE finding.tenant_id = NEW.tenant_id AND finding.audit_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Follow-up requires at least one finding.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'READY_FOR_CLOSURE' AND EXISTS (
    SELECT 1 FROM public.audit_findings finding
    WHERE finding.tenant_id = NEW.tenant_id AND finding.audit_id = NEW.id AND finding.status <> 'CLOSED'
  ) THEN
    RAISE EXCEPTION 'Every finding must be closed before audit closure.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'CLOSED' AND NOT EXISTS (
    SELECT 1 FROM public.audit_closures closure
    WHERE closure.tenant_id = NEW.tenant_id AND closure.audit_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A signed closure record is required to close an audit.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_audit_finding_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.audits audit
      WHERE audit.tenant_id = NEW.tenant_id AND audit.id = NEW.audit_id
        AND audit.status = 'IN_PROGRESS' AND audit.lead_auditor_user_id = NEW.created_by_user_id
    ) THEN
      RAISE EXCEPTION 'Findings may only be recorded by the lead auditor during execution.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.audit_id, NEW.sequence_number, NEW.code, NEW.classification, NEW.title,
         NEW.description, NEW.requirement_reference, NEW.responsible_user_id, NEW.response_due_at,
         NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.audit_id, OLD.sequence_number, OLD.code, OLD.classification, OLD.title,
         OLD.description, OLD.requirement_reference, OLD.responsible_user_id, OLD.response_due_at,
         OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Audit finding definitions are immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'OPEN' AND NEW.status = 'RESPONSE_SUBMITTED') OR
    (OLD.status = 'RESPONSE_SUBMITTED' AND NEW.status IN ('OPEN', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'Invalid audit finding transition.' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'CLOSED' AND NOT EXISTS (
    SELECT 1 FROM public.audit_finding_responses response
    WHERE response.tenant_id = NEW.tenant_id AND response.finding_id = NEW.id AND response.decision = 'ACCEPT'
  ) THEN
    RAISE EXCEPTION 'An accepted signed response is required to close a finding.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'RESPONSE_SUBMITTED' AND NEW.status = 'OPEN' AND NOT EXISTS (
    SELECT 1 FROM public.audit_finding_responses response
    WHERE response.tenant_id = NEW.tenant_id AND response.finding_id = NEW.id AND response.decision = 'REQUEST_REVISION'
  ) THEN
    RAISE EXCEPTION 'A signed revision request is required to reopen a finding.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_audit_response_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE expected_attempt integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(response.attempt_number), 0) + 1 INTO expected_attempt
    FROM public.audit_finding_responses response
    WHERE response.tenant_id = NEW.tenant_id AND response.finding_id = NEW.finding_id;
    IF NEW.attempt_number <> expected_attempt OR NOT EXISTS (
      SELECT 1 FROM public.audit_findings finding
      JOIN public.audits audit ON audit.tenant_id = finding.tenant_id AND audit.id = finding.audit_id
      WHERE finding.tenant_id = NEW.tenant_id AND finding.id = NEW.finding_id
        AND finding.status = 'OPEN' AND finding.responsible_user_id = NEW.responded_by_user_id
        AND audit.status = 'FOLLOW_UP'
    ) THEN
      RAISE EXCEPTION 'Only the responsible user may submit the next response attempt.' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id, NEW.finding_id, NEW.attempt_number, NEW.response, NEW.root_cause, NEW.correction,
         NEW.corrective_action, NEW.evidence_reference, NEW.capa_id, NEW.change_control_id,
         NEW.responded_by_user_id, NEW.response_session_id, NEW.response_meaning,
         NEW.authentication_method, NEW.responded_at, NEW.response_record_hash, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.tenant_id, OLD.finding_id, OLD.attempt_number, OLD.response, OLD.root_cause, OLD.correction,
         OLD.corrective_action, OLD.evidence_reference, OLD.capa_id, OLD.change_control_id,
         OLD.responded_by_user_id, OLD.response_session_id, OLD.response_meaning,
         OLD.authentication_method, OLD.responded_at, OLD.response_record_hash, OLD.created_at)
     OR OLD.decision IS NOT NULL OR NEW.decision IS NULL THEN
    RAISE EXCEPTION 'Signed audit responses are immutable and may be reviewed once.' USING ERRCODE = '55000';
  END IF;
  IF NEW.reviewed_by_user_id = NEW.responded_by_user_id OR NOT EXISTS (
    SELECT 1 FROM public.audit_findings finding
    JOIN public.audits audit ON audit.tenant_id = finding.tenant_id AND audit.id = finding.audit_id
    WHERE finding.tenant_id = NEW.tenant_id AND finding.id = NEW.finding_id
      AND finding.status = 'RESPONSE_SUBMITTED' AND audit.status = 'FOLLOW_UP'
      AND audit.reviewer_user_id = NEW.reviewed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Only the independent assigned reviewer may review a submitted response.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_audit_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_audit_finding_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_audit_response_mutation() FROM PUBLIC;

-- R55 INTAKE-ACCESS-02 1a (approved by the lead under Rasel's delegation, Nov 15): a client's
-- self-service start of a portal-published form makes a PENDING engagement (as Begin Online does,
-- for staff review) and its intake. A client file may now go into such an engagement, but only
-- as an answer to an open intake of it (SENT, IN_PROGRESS, NEEDS_CORRECTION); every other client
-- file still needs an ACTIVE engagement, and a carried-over lead file still goes only into the
-- ACTIVE engagement its lead converted into. Only the first check of documents_intake_rules
-- changes; the rest is as in r0_intake_engine. Safe on dev: a function replaced, no data touched.

CREATE OR REPLACE FUNCTION documents_intake_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  intake_engagement uuid;
  intake_lead uuid;
  intake_open boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 'CLIENT_TO_FIRM' THEN
      -- ACTIVE; or PENDING (a client's self-service start of a portal-published form) only for a
      -- file that answers an intake of that engagement, which must be open (checked below).
      PERFORM 1 FROM engagements e
        WHERE e.id = NEW.engagement_id
          AND (e.status = 'ACTIVE'
               OR (e.status = 'PENDING' AND NEW.intake_id IS NOT NULL
                   AND NEW.lead_upload_id IS NULL))
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'documents: a client can upload only to an open engagement (ACTIVE), or into an open intake of a PENDING one'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.intake_id IS NOT NULL THEN
      SELECT i.engagement_id, i.lead_id, i.status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION')
        INTO intake_engagement, intake_lead, intake_open
        FROM intakes i WHERE i.id = NEW.intake_id FOR SHARE;
      IF NEW.direction <> 'CLIENT_TO_FIRM' OR intake_engagement IS DISTINCT FROM NEW.engagement_id
         OR (NEW.lead_upload_id IS NULL AND NOT intake_open)
         OR (NEW.lead_upload_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM lead_uploads u
               WHERE u.id = NEW.lead_upload_id AND u.lead_id = intake_lead
                 AND u.slot = NEW.intake_slot)) THEN
        RAISE EXCEPTION 'documents: an intake upload is a client file for an open intake of its engagement'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (CASE TG_OP WHEN 'DELETE'
        THEN OLD.intake_id IS NOT NULL AND NOT coalesce(OLD.retention_until < current_date, false)
        ELSE (NEW.intake_id, NEW.intake_slot) IS DISTINCT FROM (OLD.intake_id, OLD.intake_slot) END) THEN
    PERFORM 1 FROM intakes i
      WHERE i.id = OLD.intake_id AND (TG_OP = 'DELETE' OR NEW.intake_id IS NULL)
        AND i.status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION')
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'documents: a file only leaves its intake (detached, both cleared, or deleted) while the intake is open'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END
$$;

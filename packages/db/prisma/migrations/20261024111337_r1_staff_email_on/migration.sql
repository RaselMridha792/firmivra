-- r1_staff_email_on (R1, Oct 24; Rasel's block, R60's "Column request for R1", request 8): a data
-- change only. A firm's staff always get their notification emails (R60's Notifications: the API
-- already treats a staff member's email as on and refuses turning it off), so every staff
-- member's stored preference that still says off is set on, and the table says what the API does.
-- Clients' preferences are untouched (only rows of a firm's members change).
-- Safe on dev: it changes only notification_preferences rows, each firm in its own scope (RLS is
-- forced and the migration role does not bypass it on RDS, so a plain UPDATE would change
-- nothing there); notification_preferences_rules allows an email change; no schema changes.

DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE notification_preferences np
       SET email = true, updated_at = now()
      FROM memberships m
     WHERE np.business_id = firm AND m.business_id = np.business_id
       AND m.user_id = np.user_id AND np.email = false;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

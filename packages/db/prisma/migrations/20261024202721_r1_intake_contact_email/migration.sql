-- r1_intake_contact_email (R1, Oct 24; Rasel's tap of 20:20 UTC, R60's "Column request for R1",
-- request 12): a data change only. A new firm's intake settings start with the firm's own contact
-- email (Company Profile, business_settings.contact_email) as the first of its "Notify additional
-- emails" (R60's #1115); this gives the firms' existing intake settings the same, once. The
-- address goes first in that firm's own list where the list does not hold it yet (ignoring case).
-- A firm with no valid contact email (the API's check: zod's email pattern, at most 254
-- characters), with no intake settings, or with a list already at its 10, keeps what it has.
-- Nothing else changes (updated_at included), and running it again changes nothing.
-- Safe on dev: it changes only intake_settings rows, each firm in its own scope (RLS is forced and
-- the migration role does not bypass it on RDS, so a plain UPDATE would change nothing there);
-- no schema changes; it prints nothing, so no address reaches a log.

DO $migration$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE intake_settings s
       SET notify_additional_emails = array_prepend(c.email, s.notify_additional_emails)
      FROM (SELECT business_id, lower(btrim(contact_email)) AS email
              FROM business_settings
             WHERE business_id = firm) c
     WHERE s.business_id = firm AND c.business_id = s.business_id
       AND char_length(c.email) <= 254
       AND c.email ~ $re$^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$$re$
       AND cardinality(s.notify_additional_emails) < 10
       AND NOT EXISTS (
         SELECT 1 FROM unnest(s.notify_additional_emails) e WHERE lower(btrim(e)) = c.email
       );
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$migration$;

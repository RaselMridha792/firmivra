-- r0_demo_unseed (R0, Oct 17, PART 2): a "delete every row of one firm" primitive for the demo
-- seed's unseed command, owner/migrate role only (never granted to firmivra_app -- this is an ops
-- tool, not an application feature). It finds every table with a business_id column from the
-- catalog (so it never needs editing as new demo seed modules land) and deletes that firm's rows,
-- retrying the whole set on each pass until a pass deletes nothing more, so foreign-key order never
-- has to be hand-maintained. Then it deletes the business row itself and the logins the caller
-- names (the demo's own synthetic users). Returns the tables it touched with row counts, so the
-- unseed script can report, and a test can assert, exactly what it removed.
--
-- On RDS the migrate role is no superuser and has no BYPASSRLS, and every firm table has FORCE
-- ROW LEVEL SECURITY, so as is it would see only what the firm-scope policies allow: append-only
-- tables (audit, history, payments) have no DELETE policy and would keep their rows silently, and
-- the users policy never deletes a staff login. The business-rule triggers (immutable invoice
-- lines, frozen payments, the last-active-owner rule, history writers) refuse deletes for good
-- reasons too, for a firm that keeps existing. For the whole-firm delete only, this function
-- therefore lifts FORCE ROW LEVEL SECURITY and disables the non-internal triggers on exactly the
-- tables it deletes from (the migrate role owns them, so it may), and puts every one back as it
-- was before returning. Foreign keys are internal triggers and stay enforced throughout. All of it
-- is transactional: on any error the whole call rolls back, settings included. The ALTER TABLEs
-- take ACCESS EXCLUSIVE locks until commit, so app requests on those tables wait for the few
-- seconds the call takes; run it on dev, never on production data.
CREATE FUNCTION app_delete_business_data(p_business_id uuid, p_user_ids uuid[] DEFAULT '{}')
  RETURNS TABLE(table_name text, deleted bigint)
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  -- Fail fast, rather than queue every app request behind it, when a table is busy.
  SET lock_timeout = '10s'
  AS $$
DECLARE
  tables text[];
  touched text[];
  forced text[];
  trig_tables text[] := '{}';
  trig_names text[] := '{}';
  trig_modes "char"[] := '{}';
  r record;
  t text;
  i int;
  this_delete bigint;
  pass_deleted bigint;
  counts jsonb := '{}'::jsonb;
  passes int := 0;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'app_delete_business_data: business id is required'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT coalesce(array_agg(DISTINCT c.relname::text), '{}') INTO tables
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attname = 'business_id'
    AND NOT a.attisdropped AND c.relname <> 'businesses';
  touched := tables || ARRAY['businesses', 'users'];

  -- Lift FORCE ROW LEVEL SECURITY (the owner is then exempt from RLS) where it is set.
  SELECT coalesce(array_agg(c.relname::text), '{}') INTO forced
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY (touched) AND c.relforcerowsecurity;
  FOREACH t IN ARRAY forced LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- Disable the enabled user triggers, remembering each one's mode to restore it exactly.
  FOR r IN
    SELECT c.relname::text AS rel, tg.tgname::text AS name, tg.tgenabled AS mode
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (touched)
      AND NOT tg.tgisinternal AND tg.tgenabled <> 'D'
  LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', r.rel, r.name);
    trig_tables := trig_tables || r.rel;
    trig_names := trig_names || r.name;
    trig_modes := trig_modes || r.mode;
  END LOOP;

  LOOP
    passes := passes + 1;
    IF passes > 20 THEN
      RAISE EXCEPTION 'app_delete_business_data: rows remain after 20 passes (a reference with no '
        'business_id, or a genuine cycle)' USING ERRCODE = 'check_violation';
    END IF;
    pass_deleted := 0;
    FOREACH t IN ARRAY tables LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE business_id = $1', t) USING p_business_id;
        GET DIAGNOSTICS this_delete = ROW_COUNT;
        IF this_delete > 0 THEN
          counts := jsonb_set(counts, ARRAY[t],
            to_jsonb(coalesce((counts ->> t)::bigint, 0) + this_delete));
          pass_deleted := pass_deleted + this_delete;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL; -- something else still references a row here; retry next pass
      END;
    END LOOP;
    EXIT WHEN pass_deleted = 0;
  END LOOP;

  DELETE FROM businesses WHERE id = p_business_id;
  GET DIAGNOSTICS this_delete = ROW_COUNT;
  IF this_delete > 0 THEN
    counts := jsonb_set(counts, ARRAY['businesses'], to_jsonb(this_delete));
  END IF;

  -- The named logins: a foreign key error here means one still belongs to another firm (or is a
  -- platform admin), and the whole call rolls back.
  DELETE FROM users WHERE id = ANY (coalesce(p_user_ids, '{}'));
  GET DIAGNOSTICS this_delete = ROW_COUNT;
  IF this_delete > 0 THEN
    counts := jsonb_set(counts, ARRAY['users'], to_jsonb(this_delete));
  END IF;

  FOR i IN 1 .. coalesce(array_length(trig_tables, 1), 0) LOOP
    EXECUTE format(
      CASE trig_modes[i]
        WHEN 'A' THEN 'ALTER TABLE %I ENABLE ALWAYS TRIGGER %I'
        WHEN 'R' THEN 'ALTER TABLE %I ENABLE REPLICA TRIGGER %I'
        ELSE 'ALTER TABLE %I ENABLE TRIGGER %I'
      END, trig_tables[i], trig_names[i]);
  END LOOP;
  FOREACH t IN ARRAY forced LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  RETURN QUERY SELECT key, value::text::bigint FROM jsonb_each(counts) AS kv(key, value);
END
$$;

REVOKE ALL ON FUNCTION app_delete_business_data(uuid, uuid[]) FROM PUBLIC;

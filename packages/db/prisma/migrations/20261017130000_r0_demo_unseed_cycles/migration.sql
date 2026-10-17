-- r0_demo_unseed_cycles (R0, Oct 17, PART 2 Stage 3): app_delete_business_data (r0_demo_unseed)
-- met its first foreign-key cycle once the demo seed had a completed Firm Sign request: the request
-- names its filed final PDF and certificate (final_document_id, certificate_document_id) and those
-- documents name the request (esign_request_id), so no delete order works. The function now clears
-- the request's side first (its rules triggers are off for the call, as before), and if a pass
-- ends with rows still in any firm table it raises naming those tables, instead of failing later
-- on the business row with a bare foreign-key error. Same signature; privileges are kept.
CREATE OR REPLACE FUNCTION app_delete_business_data(p_business_id uuid, p_user_ids uuid[] DEFAULT '{}')
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
  leftover text[] := '{}';
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

  -- Two-way links that no delete order can satisfy: a completed Firm Sign request names its filed
  -- final PDF and certificate, and those documents name the request. Clear the request's side.
  UPDATE esign_requests SET final_document_id = NULL, certificate_document_id = NULL
  WHERE business_id = p_business_id AND final_document_id IS NOT NULL;

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

  -- A pass that deletes nothing ends the loop; anything still there is a cycle or a reference
  -- from a table with no business_id. Say which, rather than fail on the business row.
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE business_id = $1', t) INTO this_delete
      USING p_business_id;
    IF this_delete > 0 THEN
      leftover := leftover || t;
    END IF;
  END LOOP;
  IF cardinality(leftover) > 0 THEN
    RAISE EXCEPTION 'app_delete_business_data: rows remain in % (a foreign-key cycle, or a reference '
      'from a table with no business_id)', array_to_string(leftover, ', ')
      USING ERRCODE = 'foreign_key_violation';
  END IF;

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


-- r0_demo_unseed (R0, Oct 17, PART 2): a generic "delete every row of one firm" primitive for the
-- demo seed's unseed command, owner/migrate role only (never granted to firmivra_app -- this is
-- an ops tool, not an application feature). Dynamically finds every table with a business_id
-- column (so it never needs editing as new demo seed modules land) and deletes that firm's rows,
-- retrying the whole set on each pass until a pass deletes nothing more, so foreign-key order
-- never has to be hand-maintained: a table whose rows are still referenced elsewhere just waits
-- its turn. Finally deletes the business row itself. Returns the table names it touched with row
-- counts, so the unseed script can report, and assert, exactly what it removed.
CREATE FUNCTION app_delete_business_data(p_business_id uuid)
  RETURNS TABLE(table_name text, deleted bigint)
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  tables text[];
  t text;
  this_delete bigint;
  pass_deleted bigint;
  counts jsonb := '{}'::jsonb;
  passes int := 0;
BEGIN
  SELECT coalesce(array_agg(DISTINCT c.table_name), '{}') INTO tables
  FROM information_schema.columns c
  JOIN pg_class pc ON pc.relname = c.table_name
  JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
  WHERE c.table_schema = 'public' AND c.column_name = 'business_id' AND pc.relkind = 'r'
    AND c.table_name <> 'businesses';

  -- Every business-scoped table's DELETE policy needs business scope for this firm.
  PERFORM set_config('app.scope', 'business', true);
  PERFORM set_config('app.current_business_id', p_business_id::text, true);

  -- A full firm deletion also removes its memberships, including the firm's last owner --
  -- the one case memberships_keep_an_owner must not block, since the firm itself is going
  -- away in this same statement. Disabled only for this delete loop, and always re-enabled
  -- below (even on error), so the ordinary owner protection stays intact everywhere else.
  ALTER TABLE memberships DISABLE TRIGGER memberships_keep_an_owner;

  BEGIN
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
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE memberships ENABLE TRIGGER memberships_keep_an_owner;
    RAISE;
  END;

  ALTER TABLE memberships ENABLE TRIGGER memberships_keep_an_owner;

  -- businesses itself deletes only in platform scope (businesses_delete policy).
  PERFORM set_config('app.scope', 'platform', true);
  PERFORM set_config('app.current_business_id', '', true);
  DELETE FROM businesses WHERE id = p_business_id;
  GET DIAGNOSTICS this_delete = ROW_COUNT;
  IF this_delete > 0 THEN
    counts := jsonb_set(counts, ARRAY['businesses'], to_jsonb(this_delete));
  END IF;

  RETURN QUERY SELECT key, value::text::bigint FROM jsonb_each(counts) AS kv(key, value);
END
$$;

REVOKE ALL ON FUNCTION app_delete_business_data(uuid) FROM PUBLIC;

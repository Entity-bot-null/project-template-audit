-- audit_delete_events answered 0, 0, 0 while another deletion of the same
-- application held its lock, which its callers read as "nothing left": the end
-- of an application's service then tried to finish with events still there,
-- and an erasure of scope events said none waited. It now waits for that
-- deletion (one batch), at most 5 seconds, and past that raises
-- lock_not_available (55P03), which the callers answer as "still deleting".
-- The same function otherwise; its privileges stay (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION audit_delete_events(p_app uuid, p_erasure uuid, p_limit integer DEFAULT 5000)
RETURNS TABLE ("deleted" integer, "held" integer, "unsealed" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_subject  text;
  v_trigger  text;
  v_start    timestamptz := clock_timestamp();
  v_ids      uuid[];
  v_held     integer;
  v_unsealed integer;
  v_category "AuditCategory";
  v_run      uuid;
  v_timeout  text := current_setting('lock_timeout');
BEGIN
  IF p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'limit % out of range', p_limit USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_erasure IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "connected_apps" a
                   WHERE a."id" = p_app AND NOT a."system" AND a."status" IN ('suspended', 'retired')) THEN
      RAISE EXCEPTION 'suspend the application first: its log is deleted only once ingestion stopped'
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    v_trigger := 'decommission';
  ELSE
    SELECT r."subject" INTO v_subject FROM "erasure_runs" r
      WHERE r."id" = p_erasure AND r."app_id" = p_app AND r."scope" = 'events';
    IF v_subject IS NULL THEN
      RAISE EXCEPTION 'no erasure of scope events % in this application', p_erasure
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_trigger := 'subject';
  END IF;
  -- One deletion per application at a time, across every instance: wait for
  -- the one running (a batch), at most 5 seconds, then lock_not_available.
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-delete:' || p_app::text, 0));
  PERFORM set_config('lock_timeout', v_timeout, true);
  PERFORM set_config('audit.maintenance', 'on', true);

  CREATE TEMP TABLE IF NOT EXISTS "audit_delete_scope" ("event_id" uuid, "event_category" "AuditCategory",
    "is_sealed" boolean, "is_held" boolean) ON COMMIT DROP;
  TRUNCATE "audit_delete_scope";
  INSERT INTO "audit_delete_scope"
    SELECT e."id", e."category",
           e."recorded_at" < coalesce((SELECT max(s."window_to") FROM "integrity_seals" s
                                       WHERE s."app_id" = e."app_id" AND s."category" = e."category"), '-infinity'),
           audit_event_held(e)
    FROM "audit_events" e
    WHERE e."app_id" = p_app
      AND (v_subject IS NULL OR e."actor_id" = v_subject
           OR (e."resource_type" = 'user' AND e."resource_id" = v_subject));
  SELECT count(*) FILTER (WHERE d."is_held"), count(*) FILTER (WHERE NOT d."is_sealed" AND NOT d."is_held")
    INTO v_held, v_unsealed FROM "audit_delete_scope" d;
  SELECT array_agg(x."id") INTO v_ids FROM (
    SELECT d."event_id" AS "id" FROM "audit_delete_scope" d JOIN "audit_events" e ON e."id" = d."event_id"
    WHERE d."is_sealed" AND NOT d."is_held" ORDER BY e."recorded_at", e."id" LIMIT p_limit) x;
  v_ids := coalesce(v_ids, '{}');

  -- One run per category, with each seal's count, before the events go.
  FOR v_category IN SELECT DISTINCT d."event_category" FROM "audit_delete_scope" d WHERE d."event_id" = ANY(v_ids) LOOP
    v_run := uuidv7();
    INSERT INTO "retention_runs" ("id", "app_id", "class", "cutoff", "deleted_count", "held_count",
                                  "trigger", "erasure_run_id", "started_at", "finished_at")
      SELECT v_run, p_app, v_category::text::"RetentionClass", now(),
             (SELECT count(*) FROM "audit_delete_scope" d WHERE d."event_id" = ANY(v_ids) AND d."event_category" = v_category),
             (SELECT count(*) FROM "audit_delete_scope" d WHERE d."is_held" AND d."event_category" = v_category),
             v_trigger, p_erasure, v_start, clock_timestamp();
    INSERT INTO "retention_run_seals" ("run_id", "seal_id", "deleted_count")
      SELECT v_run, s."id", count(*)::integer FROM "audit_events" e
      JOIN "integrity_seals" s ON s."app_id" = e."app_id" AND s."category" = e."category"
        AND e."recorded_at" >= s."window_from" AND e."recorded_at" < s."window_to"
      WHERE e."id" = ANY(v_ids) AND e."category" = v_category GROUP BY s."id";
  END LOOP;

  DELETE FROM "event_locations" WHERE "event_pk" = ANY(v_ids);
  DELETE FROM "event_personal" WHERE "event_pk" = ANY(v_ids);
  DELETE FROM "alert_events" WHERE "event_pk" = ANY(v_ids);
  DELETE FROM "audit_events" WHERE "id" = ANY(v_ids);
  -- A seal whose events are all gone keeps its digest and count; its leaves go.
  DELETE FROM "integrity_seal_leaves" l USING "integrity_seals" s
    WHERE s."id" = l."seal_id" AND s."app_id" = p_app
      AND NOT EXISTS (SELECT 1 FROM "audit_events" e
                      WHERE e."app_id" = s."app_id" AND e."category" = s."category"
                        AND e."recorded_at" >= s."window_from" AND e."recorded_at" < s."window_to");
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN QUERY SELECT cardinality(v_ids), v_held, v_unsealed;
END $$;

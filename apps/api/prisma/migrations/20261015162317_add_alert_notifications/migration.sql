-- Alerts, webhooks and response actions (docs/adr/0013).

-- The security alert email (schema.prisma, enum MailKind). Adding an enum
-- value is an expand step: the running version never writes it.
ALTER TYPE "MailKind" ADD VALUE 'security_alert';

-- audit_purge recorded its run before deleting anything, so finished_at (the
-- column's default, the transaction's start) came before started_at. The run
-- is now written last, with the time it really finished; its seals' counts
-- are collected before the events go (retention_runs is append-only: the
-- row cannot be completed afterwards). Otherwise the same rules as before
-- (20261015011351_add_append_only_retention_and_erasure).
CREATE OR REPLACE FUNCTION audit_purge(p_app uuid, p_class "RetentionClass", p_cutoff timestamptz,
                                       p_trigger text DEFAULT 'job', p_limit integer DEFAULT 5000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_days        integer;
  v_floor       timestamptz;
  v_run         uuid := uuidv7();
  v_start       timestamptz := clock_timestamp();
  v_ids         uuid[];
  v_held        integer := 0;
  v_sealed      timestamptz;
  v_seal_ids    uuid[];
  v_seal_counts integer[];
BEGIN
  IF p_trigger NOT IN ('job', 'cli') THEN
    RAISE EXCEPTION 'unknown trigger %', p_trigger USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_limit < 1 OR p_limit > 50000 THEN
    RAISE EXCEPTION 'limit % out of range', p_limit USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT greatest(audit_retention_min_days(p_class), coalesce(max("days"), 0)) INTO v_days
    FROM "retention_policies" WHERE "app_id" = p_app AND "class" = p_class;
  v_floor := now() - make_interval(days => v_days);
  IF p_cutoff > v_floor THEN
    RAISE EXCEPTION 'cutoff % is inside the retention of % for this application (at most %)',
      p_cutoff, p_class, v_floor USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- One purge per application and class at a time, across every instance.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('audit-purge:' || p_app::text || ':' || p_class::text, 0)) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('audit.maintenance', 'on', true);

  IF p_class IN ('personal', 'location') THEN
    IF p_class = 'personal' THEN
      SELECT array_agg(p."event_pk") INTO v_ids FROM (
        SELECT p."event_pk" FROM "event_personal" p JOIN "audit_events" e ON e."id" = p."event_pk"
        WHERE p."app_id" = p_app AND p."recorded_at" < p_cutoff AND NOT audit_event_held(e)
        ORDER BY p."recorded_at" LIMIT p_limit) p;
      SELECT count(*) INTO v_held FROM "event_personal" p JOIN "audit_events" e ON e."id" = p."event_pk"
        WHERE p."app_id" = p_app AND p."recorded_at" < p_cutoff AND audit_event_held(e);
      DELETE FROM "event_personal" WHERE "event_pk" = ANY(coalesce(v_ids, '{}'));
    ELSE
      SELECT array_agg(l."event_pk") INTO v_ids FROM (
        SELECT l."event_pk" FROM "event_locations" l JOIN "audit_events" e ON e."id" = l."event_pk"
        WHERE l."app_id" = p_app AND l."recorded_at" < p_cutoff AND NOT audit_event_held(e)
        ORDER BY l."recorded_at" LIMIT p_limit) l;
      SELECT count(*) INTO v_held FROM "event_locations" l JOIN "audit_events" e ON e."id" = l."event_pk"
        WHERE l."app_id" = p_app AND l."recorded_at" < p_cutoff AND audit_event_held(e);
      DELETE FROM "event_locations" WHERE "event_pk" = ANY(coalesce(v_ids, '{}'));
    END IF;
    INSERT INTO "retention_runs" ("id", "app_id", "class", "cutoff", "deleted_count", "held_count", "trigger", "started_at", "finished_at")
      VALUES (v_run, p_app, p_class, p_cutoff, coalesce(cardinality(v_ids), 0), v_held, p_trigger, v_start, clock_timestamp());
  ELSE
    SELECT max("window_to") INTO v_sealed FROM "integrity_seals"
      WHERE "app_id" = p_app AND "category" = p_class::text::"AuditCategory";
    IF v_sealed IS NOT NULL THEN
      SELECT array_agg(e."id") INTO v_ids FROM (
        SELECT e."id" FROM "audit_events" e
        WHERE e."app_id" = p_app AND e."category" = p_class::text::"AuditCategory"
          AND e."recorded_at" < least(p_cutoff, v_sealed) AND NOT audit_event_held(e)
        ORDER BY e."recorded_at", e."id" LIMIT p_limit) e;
      SELECT count(*) INTO v_held FROM "audit_events" e
        WHERE e."app_id" = p_app AND e."category" = p_class::text::"AuditCategory"
          AND e."recorded_at" < least(p_cutoff, v_sealed) AND audit_event_held(e);
    END IF;
    v_ids := coalesce(v_ids, '{}');
    -- How many events of each seal go, counted while they are still there.
    SELECT array_agg(x."seal_id"), array_agg(x."deleted") INTO v_seal_ids, v_seal_counts FROM (
      SELECT s."id" AS "seal_id", count(*)::integer AS "deleted" FROM "audit_events" e
      JOIN "integrity_seals" s ON s."app_id" = e."app_id" AND s."category" = e."category"
        AND e."recorded_at" >= s."window_from" AND e."recorded_at" < s."window_to"
      WHERE e."id" = ANY(v_ids) GROUP BY s."id") x;
    DELETE FROM "event_locations" WHERE "event_pk" = ANY(v_ids);
    DELETE FROM "event_personal" WHERE "event_pk" = ANY(v_ids);
    DELETE FROM "alert_events" WHERE "event_pk" = ANY(v_ids);
    DELETE FROM "audit_events" WHERE "id" = ANY(v_ids);
    -- A seal whose events are all gone keeps its digest and count; its
    -- leaves are no longer needed.
    DELETE FROM "integrity_seal_leaves" l USING "integrity_seals" s
      WHERE l."seal_id" = ANY(coalesce(v_seal_ids, '{}')) AND s."id" = l."seal_id"
        AND NOT EXISTS (
          SELECT 1 FROM "audit_events" e
          WHERE e."app_id" = s."app_id" AND e."category" = s."category"
            AND e."recorded_at" >= s."window_from" AND e."recorded_at" < s."window_to");
    INSERT INTO "retention_runs" ("id", "app_id", "class", "cutoff", "deleted_count", "held_count", "trigger", "started_at", "finished_at")
      VALUES (v_run, p_app, p_class, p_cutoff, cardinality(v_ids), v_held, p_trigger, v_start, clock_timestamp());
    INSERT INTO "retention_run_seals" ("run_id", "seal_id", "deleted_count")
      SELECT v_run, u."seal_id", u."deleted"
      FROM unnest(coalesce(v_seal_ids, '{}'), coalesce(v_seal_counts, '{}')) AS u("seal_id", "deleted");
  END IF;
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN coalesce(cardinality(v_ids), 0);
END $$;

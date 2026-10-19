-- AlterEnum
ALTER TYPE "ConnectedAppStatus" ADD VALUE 'retired';

-- AlterTable
ALTER TABLE "erasure_runs" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'personal';

-- AlterTable
ALTER TABLE "retention_runs" ADD COLUMN     "erasure_run_id" UUID;

-- AddForeignKey
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_erasure_run_id_fkey" FOREIGN KEY ("erasure_run_id") REFERENCES "erasure_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Two more deletions of the audit log, for the controller's instructions
-- (docs/privacy/; LFPDPPP arts. 24 and 25, Reglamento art. 50 fr. V): an
-- application's whole log when its service ends, and a subject's events when
-- the controller cancels them. They follow retention's rules
-- (20261015011351_add_append_only_retention_and_erasure, docs/adr/0007): in
-- SECURITY DEFINER functions, only sealed events, never what a legal hold
-- matches, every seal's count recorded in retention_run_seals, so the
-- verification tells them apart from tampering. Unlike retention, they do not
-- wait for the minimums: the controller asked, and the runs say for what.
-- Columns with defaults and constraints validated apart: no long lock.

ALTER TABLE "erasure_runs" ADD CONSTRAINT "erasure_runs_scope_check"
  CHECK ("scope" IN ('personal', 'events')) NOT VALID;
ALTER TABLE "erasure_runs" VALIDATE CONSTRAINT "erasure_runs_scope_check";

-- contract: no running version writes these triggers or a run for an
-- erasure, so widening the check and pairing them refuses nothing it writes
ALTER TABLE "retention_runs" DROP CONSTRAINT "retention_runs_check";
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_check" CHECK (
    "deleted_count" >= 0 AND "held_count" >= 0
    AND "trigger" IN ('job', 'cli', 'decommission', 'subject')
    AND (("trigger" = 'subject') = ("erasure_run_id" IS NOT NULL))) NOT VALID;
ALTER TABLE "retention_runs" VALIDATE CONSTRAINT "retention_runs_check";
CREATE INDEX "retention_runs_erasure_run_id_idx" ON "retention_runs" ("erasure_run_id")
  WHERE "erasure_run_id" IS NOT NULL;

-- Deletes at most p_limit sealed events that no legal hold matches: of a
-- suspended application, every one (p_erasure null: the end of its service),
-- or of the subject of an erasure run of scope events (p_erasure). Records one
-- run per category it deleted from, with each seal's count. Answers what it
-- deleted, what a hold keeps, and what waits for its seal (sealing takes
-- windows 2 minutes old): call it again until it deletes nothing.
CREATE FUNCTION audit_delete_events(p_app uuid, p_erasure uuid, p_limit integer DEFAULT 5000)
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
  -- One deletion per application at a time, across every instance.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('audit-delete:' || p_app::text, 0)) THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;
  PERFORM set_config('audit.maintenance', 'on', true);

  CREATE TEMP TABLE IF NOT EXISTS "audit_delete_scope" ("id" uuid, "category" "AuditCategory",
    "sealed" boolean, "held" boolean) ON COMMIT DROP;
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
  SELECT count(*) FILTER (WHERE "held"), count(*) FILTER (WHERE NOT "sealed" AND NOT "held")
    INTO v_held, v_unsealed FROM "audit_delete_scope";
  SELECT array_agg(x."id") INTO v_ids FROM (
    SELECT d."id" FROM "audit_delete_scope" d JOIN "audit_events" e ON e."id" = d."id"
    WHERE d."sealed" AND NOT d."held" ORDER BY e."recorded_at", e."id" LIMIT p_limit) x;
  v_ids := coalesce(v_ids, '{}');

  -- One run per category, with each seal's count, before the events go.
  FOR v_category IN SELECT DISTINCT d."category" FROM "audit_delete_scope" d WHERE d."id" = ANY(v_ids) LOOP
    v_run := uuidv7();
    INSERT INTO "retention_runs" ("id", "app_id", "class", "cutoff", "deleted_count", "held_count",
                                  "trigger", "erasure_run_id", "started_at", "finished_at")
      SELECT v_run, p_app, v_category::text::"RetentionClass", now(),
             (SELECT count(*) FROM "audit_delete_scope" d WHERE d."id" = ANY(v_ids) AND d."category" = v_category),
             (SELECT count(*) FROM "audit_delete_scope" d WHERE d."held" AND d."category" = v_category),
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

-- The end of a suspended application's service, once its log is gone
-- (audit_delete_events left nothing, and no active legal hold names it):
-- what Audit Hub derived from its events goes too (alerts and their history,
-- response actions, webhooks waiting, what the rules remember of its users,
-- sequences, refused batches, the connector's instances, its keys, who may
-- see it). Its seals, checkpoints, catalog, retention runs, erasure runs and
-- released holds stay: they prove what was kept and deleted. Answers the
-- rows deleted; the caller retires the application in the same transaction.
CREATE FUNCTION audit_finish_application_deletion(p_app uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total integer := 0;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "connected_apps" a
                 WHERE a."id" = p_app AND NOT a."system" AND a."status" IN ('suspended', 'retired')) THEN
    RAISE EXCEPTION 'suspend the application first' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM "audit_events" WHERE "app_id" = p_app) THEN
    RAISE EXCEPTION 'the application still has events: delete them first (audit_delete_events)'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM "legal_holds" h WHERE h."app_id" = p_app
             AND NOT EXISTS (SELECT 1 FROM "legal_hold_releases" r WHERE r."hold_id" = h."id")) THEN
    RAISE EXCEPTION 'a legal hold names the application: release it first'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('audit-delete:' || p_app::text, 0));
  PERFORM set_config('audit.maintenance', 'on', true);
  DELETE FROM "alert_events" ae USING "alerts" a WHERE ae."alert_id" = a."id" AND a."app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "alert_activities" aa USING "alerts" a WHERE aa."alert_id" = a."id" AND a."app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "response_actions" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "alerts" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "webhook_deliveries" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "actor_devices" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "actor_countries" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "actor_profiles" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "sequence_gaps" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "sequence_states" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "ingest_exceptions" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "connector_instances" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "app_keys" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  DELETE FROM "user_app_assignments" WHERE "app_id" = p_app;
  GET DIAGNOSTICS v_count = ROW_COUNT; v_total := v_total + v_count;
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN v_total;
END $$;

-- The erasure of a subject, with its scope: personal (the satellite rows, as
-- before) or events (the events go too, through audit_delete_events). Answers
-- the run's id with the counts. The three-argument form, which the version
-- before this one calls, keeps working: it is the personal scope.
CREATE FUNCTION audit_erase_subject(p_app uuid, p_subject text, p_via text, p_scope text)
RETURNS TABLE ("run_id" uuid, "personal_deleted" integer, "location_deleted" integer, "held" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_run      uuid := uuidv7();
  v_ids      uuid[];
  v_held     integer;
  v_personal integer;
  v_location integer;
BEGIN
  IF p_via NOT IN ('connector', 'event', 'panel') THEN
    RAISE EXCEPTION 'unknown origin %', p_via USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_scope NOT IN ('personal', 'events') THEN
    RAISE EXCEPTION 'unknown scope %', p_scope USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('audit.maintenance', 'on', true);
  SELECT array_agg(e."id") INTO v_ids FROM "audit_events" e
    WHERE e."app_id" = p_app AND (e."actor_id" = p_subject OR (e."resource_type" = 'user' AND e."resource_id" = p_subject))
      AND NOT audit_event_held(e);
  SELECT count(*) INTO v_held FROM "audit_events" e
    WHERE e."app_id" = p_app AND (e."actor_id" = p_subject OR (e."resource_type" = 'user' AND e."resource_id" = p_subject))
      AND audit_event_held(e);
  DELETE FROM "event_personal" WHERE "event_pk" = ANY(coalesce(v_ids, '{}'));
  GET DIAGNOSTICS v_personal = ROW_COUNT;
  DELETE FROM "event_locations" WHERE "event_pk" = ANY(coalesce(v_ids, '{}'));
  GET DIAGNOSTICS v_location = ROW_COUNT;
  INSERT INTO "erasure_runs" ("id", "app_id", "subject", "personal_deleted", "location_deleted", "held_count", "requested_via", "scope")
    VALUES (v_run, p_app, p_subject, v_personal, v_location, v_held, p_via, p_scope);
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN QUERY SELECT v_run, v_personal, v_location, v_held;
END $$;

CREATE OR REPLACE FUNCTION audit_erase_subject(p_app uuid, p_subject text, p_via text)
RETURNS TABLE ("personal_deleted" integer, "location_deleted" integer, "held" integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r."personal_deleted", r."location_deleted", r."held"
  FROM audit_erase_subject(p_app, p_subject, p_via, 'personal') r $$;

-- The API's role runs the new functions, like the others.
CREATE OR REPLACE FUNCTION audit_apply_runtime_privileges(p_role name) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = p_role) THEN
    RETURN;
  END IF;
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events", "event_personal", "event_locations", '
    '"catalog_versions", "catalog_actions", "integrity_seals", "integrity_seal_leaves", "integrity_checkpoints", '
    '"integrity_verifications", "retention_runs", "retention_run_seals", "legal_holds", "legal_hold_releases", '
    '"erasure_runs", "ingest_exceptions", "alert_activities" FROM %I', p_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION audit_purge(uuid, "RetentionClass", timestamptz, text, integer), '
    'audit_purge_ingest_exceptions(timestamptz, integer), audit_erase_subject(uuid, text, text), '
    'audit_erase_subject(uuid, text, text, text), audit_delete_events(uuid, uuid, integer), '
    'audit_finish_application_deletion(uuid) TO %I', p_role);
END $$;

REVOKE ALL ON FUNCTION audit_delete_events(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_finish_application_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_erase_subject(uuid, text, text, text) FROM PUBLIC;
SELECT audit_apply_runtime_privileges('app_runtime');

-- An erasure (audit_erase_subject) deleted the personal rows of the subject's
-- events but left what the rules derived from them, personal data too: their
-- devices (actor_devices), countries (actor_countries), last sign-in and last
-- place (actor_profiles). It now deletes those as well, unless a legal hold
-- keeps some of the subject's events. The same function otherwise; its
-- privileges stay (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION audit_erase_subject(p_app uuid, p_subject text, p_via text, p_scope text)
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
  -- What the rules derived of the subject: personal too. Kept while a hold keeps their events.
  IF v_held = 0 THEN
    DELETE FROM "actor_devices" WHERE "app_id" = p_app AND "actor_id" = p_subject;
    DELETE FROM "actor_countries" WHERE "app_id" = p_app AND "actor_id" = p_subject;
    DELETE FROM "actor_profiles" WHERE "app_id" = p_app AND "actor_id" = p_subject;
  END IF;
  INSERT INTO "erasure_runs" ("id", "app_id", "subject", "personal_deleted", "location_deleted", "held_count", "requested_via", "scope")
    VALUES (v_run, p_app, p_subject, v_personal, v_location, v_held, p_via, p_scope);
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN QUERY SELECT v_run, v_personal, v_location, v_held;
END $$;

-- An event of a subject that occurred before an erasure but arrives after it
-- (it was still in the application's queue) kept its personal rows. The rules
-- call this for such an event when they read it: its personal rows go, unless
-- a legal hold keeps the event. Answers whether it deleted any.
CREATE FUNCTION audit_erase_late(p_event uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_event    "audit_events";
  v_personal integer;
  v_location integer;
BEGIN
  SELECT * INTO v_event FROM "audit_events" WHERE "id" = p_event;
  IF NOT FOUND OR audit_event_held(v_event) OR NOT EXISTS (
    SELECT 1 FROM "erasure_runs" r
    WHERE r."app_id" = v_event."app_id" AND r."created_at" >= v_event."occurred_at"
      AND (r."subject" = v_event."actor_id"
           OR (v_event."resource_type" = 'user' AND r."subject" = v_event."resource_id"))) THEN
    RETURN false;
  END IF;
  PERFORM set_config('audit.maintenance', 'on', true);
  DELETE FROM "event_personal" WHERE "event_pk" = p_event;
  GET DIAGNOSTICS v_personal = ROW_COUNT;
  DELETE FROM "event_locations" WHERE "event_pk" = p_event;
  GET DIAGNOSTICS v_location = ROW_COUNT;
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN v_personal + v_location > 0;
END $$;

-- The API's role runs it, like the others.
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
    'audit_finish_application_deletion(uuid), audit_erase_late(uuid) TO %I', p_role);
END $$;

REVOKE ALL ON FUNCTION audit_erase_late(uuid) FROM PUBLIC;
SELECT audit_apply_runtime_privileges('app_runtime');

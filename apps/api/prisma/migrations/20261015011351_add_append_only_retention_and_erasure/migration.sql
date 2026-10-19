-- Append-only audit tables, retention and erasure in the database
-- (docs/adr/0007-make-audit-tables-append-only-with-retention-in-the-database.md).
-- Plain functions and triggers: nothing here rewrites a table or takes a long lock.

-- ── Append-only ─────────────────────────────────────────────────────────────
-- No UPDATE ever. A DELETE only inside the retention and erasure functions
-- below: they run as the tables' owner (SECURITY DEFINER) and set a
-- transaction-local flag first. The API's role is never the owner, so setting
-- the flag itself achieves nothing. TRUNCATE is not blocked (the integration
-- suites empty every table with it); app_runtime has no TRUNCATE privilege.
CREATE FUNCTION audit_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('audit.maintenance', true) = 'on'
     AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on %.% refused: the table is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "event_personal_append_only" BEFORE UPDATE OR DELETE ON "event_personal" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "event_locations_append_only" BEFORE UPDATE OR DELETE ON "event_locations" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "catalog_versions_append_only" BEFORE UPDATE OR DELETE ON "catalog_versions" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "catalog_actions_append_only" BEFORE UPDATE OR DELETE ON "catalog_actions" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "integrity_seals_append_only" BEFORE UPDATE OR DELETE ON "integrity_seals" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "integrity_seal_leaves_append_only" BEFORE UPDATE OR DELETE ON "integrity_seal_leaves" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "integrity_checkpoints_append_only" BEFORE UPDATE OR DELETE ON "integrity_checkpoints" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "integrity_verifications_append_only" BEFORE UPDATE OR DELETE ON "integrity_verifications" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "retention_runs_append_only" BEFORE UPDATE OR DELETE ON "retention_runs" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "retention_run_seals_append_only" BEFORE UPDATE OR DELETE ON "retention_run_seals" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "legal_holds_append_only" BEFORE UPDATE OR DELETE ON "legal_holds" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "legal_hold_releases_append_only" BEFORE UPDATE OR DELETE ON "legal_hold_releases" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "erasure_runs_append_only" BEFORE UPDATE OR DELETE ON "erasure_runs" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "ingest_exceptions_append_only" BEFORE UPDATE OR DELETE ON "ingest_exceptions" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();
CREATE TRIGGER "alert_activities_append_only" BEFORE UPDATE OR DELETE ON "alert_activities" FOR EACH ROW EXECUTE FUNCTION audit_forbid_mutation();

-- recorded_at belongs to the database: the transaction's start, to the
-- millisecond. Every transaction that writes events must carry a
-- transaction_timeout of at most 15 s, so none commits more than 15 s after
-- its recorded_at: a window that ended 2 minutes ago is final (sealing,
-- docs/adr/0008).
CREATE FUNCTION audit_events_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_timeout')::interval = interval '0'
     OR current_setting('transaction_timeout')::interval > interval '15 seconds' THEN
    RAISE EXCEPTION 'audit events need a transaction_timeout between 1 ms and 15 s (SET LOCAL transaction_timeout)'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  NEW.recorded_at := date_trunc('milliseconds', now());
  RETURN NEW;
END $$;
CREATE TRIGGER "audit_events_server_fields" BEFORE INSERT ON "audit_events" FOR EACH ROW EXECUTE FUNCTION audit_events_before_insert();

-- ── Retention ───────────────────────────────────────────────────────────────
-- The minimum of each class, in days: the database refuses less, whatever
-- the code asks (retention_policies' CHECK and audit_purge below).
CREATE FUNCTION audit_retention_min_days(c "RetentionClass") RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE c WHEN 'security' THEN 730 WHEN 'audit' THEN 365 WHEN 'access' THEN 180
                WHEN 'system' THEN 30 WHEN 'audit_access' THEN 730
                WHEN 'personal' THEN 90 WHEN 'location' THEN 30 END $$;
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_days_check"
  CHECK ("days" >= audit_retention_min_days("class") AND "days" <= 3650);

-- Whether a legal hold that is not released matches an event.
CREATE FUNCTION audit_event_held(e "audit_events") RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "legal_holds" h
    WHERE h."app_id" = e."app_id"
      AND NOT EXISTS (SELECT 1 FROM "legal_hold_releases" r WHERE r."hold_id" = h."id")
      AND (h."actor_id" IS NULL OR h."actor_id" = e."actor_id")
      AND (h."actor_email_hmac" IS NULL OR h."actor_email_hmac" = e."actor_email_hmac")
      AND (h."resource_id" IS NULL OR (h."resource_type" = e."resource_type" AND h."resource_id" = e."resource_id"))
      AND (h."from_at" IS NULL OR e."recorded_at" >= h."from_at")
      AND (h."to_at" IS NULL OR e."recorded_at" < h."to_at")) $$;

-- Deletes, for one application and one retention class, at most p_limit
-- rows older than p_cutoff: never inside the retention period (the class's
-- minimum or the application's longer policy), never an event outside a
-- sealed window (it was never sealed), never what a legal hold matches.
-- Records the run, and how many events of each seal it deleted (what the
-- integrity verification accounts missing leaves with). Answers the count.
CREATE FUNCTION audit_purge(p_app uuid, p_class "RetentionClass", p_cutoff timestamptz,
                            p_trigger text DEFAULT 'job', p_limit integer DEFAULT 5000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_days   integer;
  v_floor  timestamptz;
  v_run    uuid := uuidv7();
  v_start  timestamptz := clock_timestamp();
  v_ids    uuid[];
  v_held   integer := 0;
  v_sealed timestamptz;
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
    INSERT INTO "retention_runs" ("id", "app_id", "class", "cutoff", "deleted_count", "held_count", "trigger", "started_at")
      VALUES (v_run, p_app, p_class, p_cutoff, coalesce(cardinality(v_ids), 0), v_held, p_trigger, v_start);
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
    INSERT INTO "retention_runs" ("id", "app_id", "class", "cutoff", "deleted_count", "held_count", "trigger", "started_at")
      VALUES (v_run, p_app, p_class, p_cutoff, cardinality(v_ids), v_held, p_trigger, v_start);
    INSERT INTO "retention_run_seals" ("run_id", "seal_id", "deleted_count")
      SELECT v_run, s."id", count(*)::integer FROM "audit_events" e
      JOIN "integrity_seals" s ON s."app_id" = e."app_id" AND s."category" = e."category"
        AND e."recorded_at" >= s."window_from" AND e."recorded_at" < s."window_to"
      WHERE e."id" = ANY(v_ids) GROUP BY s."id";
    DELETE FROM "event_locations" WHERE "event_pk" = ANY(v_ids);
    DELETE FROM "event_personal" WHERE "event_pk" = ANY(v_ids);
    DELETE FROM "alert_events" WHERE "event_pk" = ANY(v_ids);
    DELETE FROM "audit_events" WHERE "id" = ANY(v_ids);
    -- A seal whose events are all gone keeps its digest and count; its
    -- leaves are no longer needed.
    DELETE FROM "integrity_seal_leaves" l USING "retention_run_seals" rs, "integrity_seals" s
      WHERE rs."run_id" = v_run AND l."seal_id" = rs."seal_id" AND s."id" = rs."seal_id"
        AND NOT EXISTS (
          SELECT 1 FROM "audit_events" e
          WHERE e."app_id" = s."app_id" AND e."category" = s."category"
            AND e."recorded_at" >= s."window_from" AND e."recorded_at" < s."window_to");
  END IF;
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN coalesce(cardinality(v_ids), 0);
END $$;

-- The bookkeeping of refused events (ingest_exceptions) is kept 90 days.
CREATE FUNCTION audit_purge_ingest_exceptions(p_cutoff timestamptz, p_limit integer DEFAULT 5000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_cutoff > now() - interval '90 days' THEN
    RAISE EXCEPTION 'ingest exceptions are kept 90 days (cutoff %)', p_cutoff USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('audit.maintenance', 'on', true);
  DELETE FROM "ingest_exceptions" WHERE "id" IN (
    SELECT "id" FROM "ingest_exceptions" WHERE "received_at" < p_cutoff ORDER BY "received_at" LIMIT p_limit);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN v_count;
END $$;

-- The right to erasure (docs/security.md): the satellite rows of every event
-- where the subject is the actor or the resource, except what a legal hold
-- matches. The events stay, pseudonymized. Records the run.
CREATE FUNCTION audit_erase_subject(p_app uuid, p_subject text, p_via text)
RETURNS TABLE ("personal_deleted" integer, "location_deleted" integer, "held" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ids      uuid[];
  v_held     integer;
  v_personal integer;
  v_location integer;
BEGIN
  IF p_via NOT IN ('connector', 'event', 'panel') THEN
    RAISE EXCEPTION 'unknown origin %', p_via USING ERRCODE = 'invalid_parameter_value';
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
  INSERT INTO "erasure_runs" ("id", "app_id", "subject", "personal_deleted", "location_deleted", "held_count", "requested_via")
    VALUES (uuidv7(), p_app, p_subject, v_personal, v_location, v_held, p_via);
  PERFORM set_config('audit.maintenance', 'off', true);
  RETURN QUERY SELECT v_personal, v_location, v_held;
END $$;

-- ── The runtime role's privileges ───────────────────────────────────────────
-- In one place: this migration calls it, roles.sql calls it after its blanket
-- GRANT (which would otherwise give UPDATE and DELETE back), and the
-- integration setup calls it after creating app_runtime. A role that does
-- not exist is skipped (development databases have none).
CREATE FUNCTION audit_apply_runtime_privileges(p_role name) RETURNS void
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
    'audit_purge_ingest_exceptions(timestamptz, integer), audit_erase_subject(uuid, text, text) TO %I', p_role);
END $$;

REVOKE ALL ON FUNCTION audit_purge(uuid, "RetentionClass", timestamptz, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_purge_ingest_exceptions(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_erase_subject(uuid, text, text) FROM PUBLIC;
SELECT audit_apply_runtime_privileges('app_runtime');

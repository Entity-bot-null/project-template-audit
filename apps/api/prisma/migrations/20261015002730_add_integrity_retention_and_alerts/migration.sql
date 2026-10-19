-- CreateEnum
CREATE TYPE "RetentionClass" AS ENUM ('security', 'audit', 'access', 'system', 'audit_access', 'personal', 'location');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'in_review', 'resolved', 'false_positive');

-- CreateEnum
CREATE TYPE "WebhookTarget" AS ENUM ('app', 'slack', 'teams');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sending', 'delivered', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "ResponseActionStatus" AS ENUM ('pending_approval', 'dispatched', 'succeeded', 'failed', 'refused', 'unsupported', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "integrity_seals" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "seal_no" BIGINT NOT NULL,
    "window_from" TIMESTAMPTZ(3) NOT NULL,
    "window_to" TIMESTAMPTZ(3) NOT NULL,
    "event_count" INTEGER NOT NULL,
    "leaves_digest" BYTEA NOT NULL,
    "prev_hash" BYTEA NOT NULL,
    "seal_hash" BYTEA NOT NULL,
    "key_id" TEXT NOT NULL,
    "signature" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_seals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrity_seal_leaves" (
    "seal_id" UUID NOT NULL,
    "leaves" BYTEA NOT NULL,

    CONSTRAINT "integrity_seal_leaves_pkey" PRIMARY KEY ("seal_id")
);

-- CreateTable
CREATE TABLE "integrity_checkpoints" (
    "id" UUID NOT NULL,
    "heads" JSONB NOT NULL,
    "digest" BYTEA NOT NULL,
    "key_id" TEXT NOT NULL,
    "signature" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrity_verifications" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "events_checked" BIGINT NOT NULL,
    "seals_checked" INTEGER NOT NULL,
    "failures" INTEGER NOT NULL,
    "failure_sample" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integrity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "app_id" UUID NOT NULL,
    "class" "RetentionClass" NOT NULL,
    "days" INTEGER NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("app_id","class")
);

-- CreateTable
CREATE TABLE "retention_runs" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "class" "RetentionClass" NOT NULL,
    "cutoff" TIMESTAMPTZ(3) NOT NULL,
    "deleted_count" INTEGER NOT NULL,
    "held_count" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_run_seals" (
    "run_id" UUID NOT NULL,
    "seal_id" UUID NOT NULL,
    "deleted_count" INTEGER NOT NULL,

    CONSTRAINT "retention_run_seals_pkey" PRIMARY KEY ("run_id","seal_id")
);

-- CreateTable
CREATE TABLE "legal_holds" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "case_ref" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email_hmac" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "from_at" TIMESTAMPTZ(3),
    "to_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_hold_releases" (
    "hold_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "released_by_id" UUID NOT NULL,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_hold_releases_pkey" PRIMARY KEY ("hold_id")
);

-- CreateTable
CREATE TABLE "erasure_runs" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "personal_deleted" INTEGER NOT NULL,
    "location_deleted" INTEGER NOT NULL,
    "held_count" INTEGER NOT NULL,
    "requested_via" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erasure_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actor_devices" (
    "app_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "device_key" TEXT NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "actor_devices_pkey" PRIMARY KEY ("app_id","actor_id","device_key")
);

-- CreateTable
CREATE TABLE "actor_countries" (
    "app_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "actor_countries_pkey" PRIMARY KEY ("app_id","actor_id","country")
);

-- CreateTable
CREATE TABLE "actor_profiles" (
    "app_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_sign_in_at" TIMESTAMPTZ(3),
    "last_latitude" DECIMAL(6,3),
    "last_longitude" DECIMAL(6,3),
    "last_accuracy_km" INTEGER,
    "last_location_at" TIMESTAMPTZ(3),

    CONSTRAINT "actor_profiles_pkey" PRIMARY KEY ("app_id","actor_id")
);

-- CreateTable
CREATE TABLE "rule_cursors" (
    "name" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "event_pk" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rule_cursors_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "AuditSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "group_key" TEXT NOT NULL,
    "subject" TEXT,
    "title" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "assignee_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_activities" (
    "id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "user_id" UUID,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "alert_id" UUID NOT NULL,
    "event_pk" UUID NOT NULL,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("alert_id","event_pk")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "app_id" UUID,
    "target" "WebhookTarget" NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_actions" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "action" "ResponseActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ResponseActionStatus" NOT NULL,
    "alert_id" UUID,
    "requested_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "delivery_id" UUID,
    "result_event_pk" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "response_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integrity_seals_app_id_category_window_to_idx" ON "integrity_seals"("app_id", "category", "window_to");

-- CreateIndex
CREATE UNIQUE INDEX "integrity_seals_app_id_category_seal_no_key" ON "integrity_seals"("app_id", "category", "seal_no");

-- CreateIndex
CREATE INDEX "integrity_checkpoints_created_at_idx" ON "integrity_checkpoints"("created_at");

-- CreateIndex
CREATE INDEX "integrity_verifications_finished_at_idx" ON "integrity_verifications"("finished_at");

-- CreateIndex
CREATE INDEX "retention_runs_app_id_class_finished_at_idx" ON "retention_runs"("app_id", "class", "finished_at");

-- CreateIndex
CREATE INDEX "retention_run_seals_seal_id_idx" ON "retention_run_seals"("seal_id");

-- CreateIndex
CREATE INDEX "legal_holds_app_id_idx" ON "legal_holds"("app_id");

-- CreateIndex
CREATE INDEX "erasure_runs_app_id_subject_idx" ON "erasure_runs"("app_id", "subject");

-- CreateIndex
CREATE INDEX "actor_devices_last_seen_at_idx" ON "actor_devices"("last_seen_at");

-- CreateIndex
CREATE INDEX "actor_countries_last_seen_at_idx" ON "actor_countries"("last_seen_at");

-- CreateIndex
CREATE INDEX "actor_profiles_last_seen_at_idx" ON "actor_profiles"("last_seen_at");

-- CreateIndex
CREATE INDEX "alerts_app_id_status_last_seen_at_idx" ON "alerts"("app_id", "status", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_assignee_id_idx" ON "alerts"("assignee_id");

-- CreateIndex
CREATE INDEX "alert_activities_alert_id_created_at_idx" ON "alert_activities"("alert_id", "created_at");

-- CreateIndex
CREATE INDEX "alert_events_event_pk_idx" ON "alert_events"("event_pk");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_app_id_created_at_idx" ON "webhook_deliveries"("app_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

-- CreateIndex
CREATE INDEX "response_actions_app_id_status_idx" ON "response_actions"("app_id", "status");

-- CreateIndex
CREATE INDEX "response_actions_alert_id_idx" ON "response_actions"("alert_id");

-- AddForeignKey
ALTER TABLE "integrity_seals" ADD CONSTRAINT "integrity_seals_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrity_seal_leaves" ADD CONSTRAINT "integrity_seal_leaves_seal_id_fkey" FOREIGN KEY ("seal_id") REFERENCES "integrity_seals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_run_seals" ADD CONSTRAINT "retention_run_seals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "retention_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_run_seals" ADD CONSTRAINT "retention_run_seals_seal_id_fkey" FOREIGN KEY ("seal_id") REFERENCES "integrity_seals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_hold_releases" ADD CONSTRAINT "legal_hold_releases_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "legal_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erasure_runs" ADD CONSTRAINT "erasure_runs_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_activities" ADD CONSTRAINT "alert_activities_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_event_pk_fkey" FOREIGN KEY ("event_pk") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── What Prisma does not express (schema.prisma comments) ──────────────────

ALTER TABLE "integrity_seals" ADD CONSTRAINT "integrity_seals_check" CHECK (
    "seal_no" >= 1 AND "window_from" < "window_to" AND "event_count" >= 1
    AND octet_length("leaves_digest") = 32 AND octet_length("prev_hash") = 32
    AND octet_length("seal_hash") = 32 AND octet_length("signature") = 32);
-- n × (16-byte event pk ‖ 32-byte content hash).
ALTER TABLE "integrity_seal_leaves" ADD CONSTRAINT "integrity_seal_leaves_check" CHECK (
    octet_length("leaves") > 0 AND octet_length("leaves") % 48 = 0);
ALTER TABLE "integrity_checkpoints" ADD CONSTRAINT "integrity_checkpoints_check" CHECK (
    octet_length("digest") = 32 AND octet_length("signature") = 32);
ALTER TABLE "integrity_verifications" ADD CONSTRAINT "integrity_verifications_check" CHECK (
    "trigger" IN ('job', 'cli') AND "outcome" IN ('passed', 'failed', 'error')
    AND "failures" >= 0 AND "events_checked" >= 0 AND "seals_checked" >= 0);

ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_check" CHECK (
    "deleted_count" >= 0 AND "held_count" >= 0 AND "trigger" IN ('job', 'cli'));
ALTER TABLE "retention_run_seals" ADD CONSTRAINT "retention_run_seals_check" CHECK ("deleted_count" >= 1);
-- A hold matches something: at least one criterion besides the application.
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_scope_check" CHECK (
    num_nonnulls("actor_id", "actor_email_hmac", "resource_id", "from_at", "to_at") >= 1
    AND ("resource_id" IS NULL OR "resource_type" IS NOT NULL)
    AND ("from_at" IS NULL OR "to_at" IS NULL OR "from_at" < "to_at")
    AND char_length("case_ref") BETWEEN 1 AND 100 AND char_length("reason") BETWEEN 10 AND 500);
ALTER TABLE "legal_hold_releases" ADD CONSTRAINT "legal_hold_releases_reason_check" CHECK (char_length("reason") BETWEEN 10 AND 500);
ALTER TABLE "erasure_runs" ADD CONSTRAINT "erasure_runs_check" CHECK (
    "personal_deleted" >= 0 AND "location_deleted" >= 0 AND "held_count" >= 0
    AND "requested_via" IN ('connector', 'event', 'panel'));

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_check" CHECK (
    "occurrences" >= 1 AND "version" >= 0 AND "first_seen_at" <= "last_seen_at"
    AND (("status" IN ('resolved', 'false_positive')) = ("resolved_at" IS NOT NULL)));
ALTER TABLE "alert_activities" ADD CONSTRAINT "alert_activities_kind_check" CHECK (
    "kind" IN ('created', 'occurrence', 'status_changed', 'assigned', 'note', 'notified', 'action_requested')
    AND ("note" IS NULL OR char_length("note") <= 2000));
-- One open alert per group key: a rule firing again adds an occurrence.
CREATE UNIQUE INDEX "alerts_open_group_key" ON "alerts" ("group_key") WHERE "status" IN ('open', 'in_review');

-- The webhook outbox's invariants, like the mail outbox's.
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_check" CHECK (
    "attempts" >= 0
    AND ("status" <> 'sending' OR "locked_until" IS NOT NULL)
    AND (("status" = 'delivered') = ("delivered_at" IS NOT NULL))
    AND (("target" = 'app') = ("app_id" IS NOT NULL)));

ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_approver_check" CHECK (
    "approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id");
ALTER TABLE "response_actions" ADD CONSTRAINT "response_actions_reason_check" CHECK (char_length("reason") BETWEEN 10 AND 500);

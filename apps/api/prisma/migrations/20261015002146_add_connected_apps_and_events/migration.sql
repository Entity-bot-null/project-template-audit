-- CreateEnum
CREATE TYPE "ConnectedAppStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "ResponseActionType" AS ENUM ('revoke_sessions', 'require_password_change', 'disable_account');

-- CreateEnum
CREATE TYPE "IngestExceptionKind" AS ENUM ('rejected', 'duplicate');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('security', 'audit', 'access', 'system', 'audit_access');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('success', 'failure', 'denied');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('info', 'low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'service', 'system', 'anonymous');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('web', 'ios', 'android', 'api', 'job');

-- CreateEnum
CREATE TYPE "IpScope" AS ENUM ('public', 'private', 'loopback', 'link_local', 'shared', 'reserved');

-- CreateTable
CREATE TABLE "connected_apps" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" "ConnectedAppStatus" NOT NULL DEFAULT 'active',
    "system" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "webhook_secret" BYTEA,
    "webhook_secret_previous" BYTEA,
    "webhook_previous_until" TIMESTAMPTZ(3),
    "pseudonym_key" BYTEA NOT NULL,
    "correlation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "accepted_response_actions" "ResponseActionType"[] DEFAULT ARRAY[]::"ResponseActionType"[],
    "require_action_approval" BOOLEAN NOT NULL DEFAULT true,
    "heartbeat_timeout_sec" INTEGER NOT NULL DEFAULT 300,
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 120,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connected_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_keys" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "secret" BYTEA NOT NULL,
    "enc_key_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_versions" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key_id" UUID NOT NULL,

    CONSTRAINT "catalog_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_actions" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "severity" "AuditSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "tags" TEXT[],
    "user_visible" BOOLEAN NOT NULL,
    "description" TEXT NOT NULL,
    "spec" JSONB NOT NULL,

    CONSTRAINT "catalog_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_nonces" (
    "key_id" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ingest_nonces_pkey" PRIMARY KEY ("key_id","nonce")
);

-- CreateTable
CREATE TABLE "sequence_states" (
    "app_id" UUID NOT NULL,
    "epoch" UUID NOT NULL,
    "contiguous_through" BIGINT NOT NULL DEFAULT 0,
    "max_seen" BIGINT NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequence_states_pkey" PRIMARY KEY ("app_id","epoch")
);

-- CreateTable
CREATE TABLE "sequence_gaps" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "epoch" UUID NOT NULL,
    "from_seq" BIGINT NOT NULL,
    "to_seq" BIGINT NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,

    CONSTRAINT "sequence_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_exceptions" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "epoch" UUID,
    "source_seq" BIGINT,
    "event_id" TEXT,
    "kind" "IngestExceptionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "error_paths" TEXT[],
    "payload_bytes" INTEGER NOT NULL,
    "connector_version" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_instances" (
    "app_id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "connector_name" TEXT NOT NULL,
    "connector_version" TEXT NOT NULL,
    "contract_version" INTEGER NOT NULL,
    "app_version" TEXT NOT NULL,
    "catalog_version" TEXT NOT NULL,
    "queue_size" INTEGER NOT NULL,
    "queue_oldest_age_sec" INTEGER NOT NULL,
    "queue_retrying" INTEGER NOT NULL,
    "discarded_at_sign_out" INTEGER NOT NULL,
    "last_heartbeat_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connector_instances_pkey" PRIMARY KEY ("app_id","instance_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "sequence_epoch" UUID,
    "source_seq" BIGINT,
    "catalog_version_id" UUID,
    "schema_version" SMALLINT NOT NULL,
    "connector_name" TEXT NOT NULL,
    "connector_version" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "AuditCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "severity" "AuditSeverity" NOT NULL,
    "risk_score" SMALLINT NOT NULL,
    "reason" TEXT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "actor_email_hmac" TEXT,
    "actor_email_hmac_shared" TEXT,
    "impersonator_id" TEXT,
    "session_ref" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "parent_resource_type" TEXT,
    "parent_resource_id" TEXT,
    "change_before" JSONB,
    "change_after" JSONB,
    "changed_fields" TEXT[],
    "request_id" TEXT,
    "trace_id" TEXT,
    "http_method" TEXT,
    "http_route" TEXT,
    "http_status" SMALLINT,
    "duration_ms" INTEGER,
    "client_type" "ClientType",
    "client_app_version" TEXT,
    "client_app_build" TEXT,
    "client_update_id" UUID,
    "client_os" TEXT,
    "client_os_version" TEXT,
    "client_device_model" TEXT,
    "client_locale" TEXT,
    "client_time_zone" TEXT,
    "client_network_type" TEXT,
    "client_route" TEXT,
    "client_sdk" TEXT,
    "client_declared" TEXT[],
    "ip_scope" "IpScope",
    "geo_country" CHAR(2),
    "geo_asn" INTEGER,
    "ua_browser" TEXT,
    "ua_os" TEXT,
    "ua_device_class" TEXT,
    "details" JSONB,
    "truncated_fields" TEXT[],
    "dropped_fields" TEXT[],
    "flags" TEXT[],
    "personal_digest" BYTEA,
    "location_digest" BYTEA,
    "content_hash" BYTEA NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_personal" (
    "event_pk" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "salt" BYTEA NOT NULL,
    "ip" INET,
    "user_agent" TEXT,
    "device_id" TEXT,
    "actor_label" TEXT,
    "resource_label" TEXT,
    "geo_subdivision" TEXT,
    "geo_city" TEXT,
    "geo_latitude" DECIMAL(6,3),
    "geo_longitude" DECIMAL(6,3),
    "geo_accuracy_km" INTEGER,
    "personal_change" JSONB,

    CONSTRAINT "event_personal_pkey" PRIMARY KEY ("event_pk")
);

-- CreateTable
CREATE TABLE "event_locations" (
    "event_pk" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "salt" BYTEA NOT NULL,
    "latitude" DECIMAL(5,2) NOT NULL,
    "longitude" DECIMAL(5,2) NOT NULL,
    "accuracy_m" INTEGER NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_locations_pkey" PRIMARY KEY ("event_pk")
);

-- CreateIndex
CREATE UNIQUE INDEX "connected_apps_slug_key" ON "connected_apps"("slug");

-- CreateIndex
CREATE INDEX "app_keys_app_id_idx" ON "app_keys"("app_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_versions_app_id_version_key" ON "catalog_versions"("app_id", "version");

-- CreateIndex
CREATE INDEX "catalog_actions_app_id_action_idx" ON "catalog_actions"("app_id", "action");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_actions_catalog_version_id_action_key" ON "catalog_actions"("catalog_version_id", "action");

-- CreateIndex
CREATE INDEX "ingest_nonces_expires_at_idx" ON "ingest_nonces"("expires_at");

-- CreateIndex
CREATE INDEX "sequence_gaps_app_id_closed_at_idx" ON "sequence_gaps"("app_id", "closed_at");

-- CreateIndex
CREATE INDEX "ingest_exceptions_app_id_epoch_source_seq_idx" ON "ingest_exceptions"("app_id", "epoch", "source_seq");

-- CreateIndex
CREATE INDEX "ingest_exceptions_received_at_idx" ON "ingest_exceptions"("received_at");

-- CreateIndex
CREATE INDEX "connector_instances_last_heartbeat_at_idx" ON "connector_instances"("last_heartbeat_at");

-- CreateIndex
CREATE INDEX "audit_events_app_id_recorded_at_id_idx" ON "audit_events"("app_id", "recorded_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_events_app_id_category_recorded_at_idx" ON "audit_events"("app_id", "category", "recorded_at");

-- CreateIndex
CREATE INDEX "audit_events_app_id_action_recorded_at_idx" ON "audit_events"("app_id", "action", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_catalog_version_id_idx" ON "audit_events"("catalog_version_id");

-- CreateIndex
CREATE INDEX "audit_events_recorded_at_idx" ON "audit_events"("recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_app_id_event_id_key" ON "audit_events"("app_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_app_id_sequence_epoch_source_seq_key" ON "audit_events"("app_id", "sequence_epoch", "source_seq");

-- CreateIndex
CREATE INDEX "event_personal_app_id_ip_recorded_at_idx" ON "event_personal"("app_id", "ip", "recorded_at");

-- CreateIndex
CREATE INDEX "event_personal_recorded_at_idx" ON "event_personal"("recorded_at");

-- CreateIndex
CREATE INDEX "event_locations_recorded_at_idx" ON "event_locations"("recorded_at");

-- AddForeignKey
ALTER TABLE "app_keys" ADD CONSTRAINT "app_keys_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_actions" ADD CONSTRAINT "catalog_actions_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_states" ADD CONSTRAINT "sequence_states_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_gaps" ADD CONSTRAINT "sequence_gaps_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_exceptions" ADD CONSTRAINT "ingest_exceptions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_instances" ADD CONSTRAINT "connector_instances_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_personal" ADD CONSTRAINT "event_personal_event_pk_fkey" FOREIGN KEY ("event_pk") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_event_pk_fkey" FOREIGN KEY ("event_pk") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── What Prisma does not express (schema.prisma comments) ──────────────────

-- Connected applications: a slug fit for metric labels and URLs, limits in range.
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_slug_check" CHECK ("slug" ~ '^[a-z][a-z0-9-]{1,30}$');
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_environment_check" CHECK ("environment" ~ '^[a-z][a-z0-9-]{0,15}$');
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_limits_check" CHECK (
    "heartbeat_timeout_sec" BETWEEN 60 AND 86400 AND "rate_limit_per_minute" BETWEEN 1 AND 10000);
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_webhook_check" CHECK (
    ("webhook_url" IS NULL OR "webhook_url" ~ '^https?://') AND
    (("webhook_secret_previous" IS NULL) = ("webhook_previous_until" IS NULL)));
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_version_check" CHECK ("version" ~ '^[0-9a-f]{16}$');
ALTER TABLE "catalog_actions" ADD CONSTRAINT "catalog_actions_source_check" CHECK ("source" IN ('server', 'client', 'both'));
ALTER TABLE "catalog_actions" ADD CONSTRAINT "catalog_actions_category_check" CHECK ("category" <> 'audit_access');

-- Events: the formats of the contract, enforced for every writer.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_risk_check" CHECK ("risk_score" BETWEEN 0 AND 100);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_status_check" CHECK ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599);
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_hash_check" CHECK (
    octet_length("content_hash") = 32
    AND ("personal_digest" IS NULL OR octet_length("personal_digest") = 32)
    AND ("location_digest" IS NULL OR octet_length("location_digest") = 32));
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_hmac_check" CHECK (
    ("actor_email_hmac" IS NULL OR "actor_email_hmac" ~ '^[0-9a-f]{64}$')
    AND ("actor_email_hmac_shared" IS NULL OR "actor_email_hmac_shared" ~ '^[0-9a-f]{64}$')
    AND ("session_ref" IS NULL OR "session_ref" ~ '^[0-9a-f]{64}$'));
-- A user actor always has an id; an anonymous one never does.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_check" CHECK (
    ("actor_type" <> 'user' OR "actor_id" IS NOT NULL)
    AND ("actor_type" <> 'anonymous' OR "actor_id" IS NULL));
-- Events from applications carry their sequence; Audit Hub's own do not.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_seq_check" CHECK (
    ("source_seq" IS NULL) = ("sequence_epoch" IS NULL)
    AND ("source_seq" IS NULL OR "source_seq" >= 1));
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_country_check" CHECK ("geo_country" IS NULL OR "geo_country" ~ '^[A-Z]{2}$');
ALTER TABLE "event_personal" ADD CONSTRAINT "event_personal_salt_check" CHECK (octet_length("salt") = 16);
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_check" CHECK (
    octet_length("salt") = 16 AND "accuracy_m" BETWEEN 1000 AND 100000
    AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180);

-- Ingestion bookkeeping.
ALTER TABLE "sequence_states" ADD CONSTRAINT "sequence_states_check" CHECK ("contiguous_through" >= 0 AND "max_seen" >= "contiguous_through");
ALTER TABLE "sequence_gaps" ADD CONSTRAINT "sequence_gaps_range_check" CHECK ("from_seq" >= 1 AND "to_seq" >= "from_seq");
ALTER TABLE "sequence_gaps" ADD CONSTRAINT "sequence_gaps_closed_check" CHECK (
    ("closed_at" IS NULL) = ("closed_reason" IS NULL)
    AND ("closed_reason" IS NULL OR "closed_reason" IN ('arrived', 'acknowledged')));
ALTER TABLE "ingest_exceptions" ADD CONSTRAINT "ingest_exceptions_size_check" CHECK ("payload_bytes" >= 0);

-- The explorer filters on optional columns: partial indexes skip the rows
-- that do not have them.
CREATE INDEX "audit_events_actor_idx" ON "audit_events" ("app_id", "actor_id", "recorded_at" DESC) WHERE "actor_id" IS NOT NULL;
CREATE INDEX "audit_events_email_idx" ON "audit_events" ("app_id", "actor_email_hmac", "recorded_at" DESC) WHERE "actor_email_hmac" IS NOT NULL;
CREATE INDEX "audit_events_resource_idx" ON "audit_events" ("app_id", "resource_type", "resource_id", "recorded_at" DESC) WHERE "resource_id" IS NOT NULL;
CREATE INDEX "audit_events_request_idx" ON "audit_events" ("app_id", "request_id") WHERE "request_id" IS NOT NULL;
CREATE INDEX "audit_events_failures_idx" ON "audit_events" ("app_id", "recorded_at" DESC) WHERE "outcome" <> 'success';
CREATE INDEX "sequence_gaps_open_idx" ON "sequence_gaps" ("app_id", "epoch") WHERE "closed_at" IS NULL;

-- Audit Hub's own application: its sign-ins and the use of its pages
-- (audit_access) are events like any other. Its pseudonymization key is set
-- at boot (connected-apps/system-app.ts) and never leaves the server.
INSERT INTO "connected_apps" ("id", "slug", "name", "environment", "system", "pseudonym_key", "updated_at")
VALUES ('00000000-0000-7000-8000-000000000001', 'audit-hub', 'Audit Hub', 'self', true, '\x'::bytea, CURRENT_TIMESTAMP);

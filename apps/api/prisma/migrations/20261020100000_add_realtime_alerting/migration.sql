-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "acknowledged_at" TIMESTAMPTZ(3),
ADD COLUMN     "acknowledged_by_id" UUID,
ADD COLUMN     "escalation_base_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "escalations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_escalated_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "alert_mutes" (
    "id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "rule" TEXT,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "ended_by_id" UUID,

    CONSTRAINT "alert_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detection_rule_settings" (
    "rule" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" "AuditSeverity",
    "params" JSONB NOT NULL DEFAULT '{}',
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "detection_rule_settings_pkey" PRIMARY KEY ("rule")
);

-- CreateTable
CREATE TABLE "escalation_policies" (
    "severity" "AuditSeverity" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "first_after_minutes" INTEGER NOT NULL,
    "repeat_every_minutes" INTEGER NOT NULL,
    "max_escalations" INTEGER NOT NULL,
    "channels" TEXT[],
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("severity")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "preferences" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "alert_mutes_app_id_until_idx" ON "alert_mutes"("app_id", "until");

-- CreateIndex
CREATE INDEX "alerts_updated_at_id_idx" ON "alerts"("updated_at", "id");

-- CreateIndex
CREATE INDEX "alerts_app_id_rule_created_at_idx" ON "alerts"("app_id", "rule", "created_at");

-- AddForeignKey
ALTER TABLE "alert_mutes" ADD CONSTRAINT "alert_mutes_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Escalation counts from now for the alerts already open (the default above):
-- deploying this never escalates every old alert at once.

-- Acknowledged by someone, or not at all; escalations never negative.
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledgement_check"
  CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by_id" IS NULL) AND "escalations" >= 0);

-- The escalation job's candidates: open alerts nobody acknowledged.
CREATE INDEX "alerts_unacknowledged_open_idx" ON "alerts" ("severity", "escalation_base_at")
  WHERE "status" = 'open' AND "acknowledged_at" IS NULL;

-- A new history entry for each: acknowledged, escalated (a superset of the
-- kinds allowed so far).
ALTER TABLE "alert_activities" DROP CONSTRAINT "alert_activities_kind_check";
ALTER TABLE "alert_activities" ADD CONSTRAINT "alert_activities_kind_check"
  CHECK ("kind" IN ('created','occurrence','status_changed','assigned','note','notified','action_requested','acknowledged','escalated')
         AND ("note" IS NULL OR char_length("note") <= 2000));

ALTER TABLE "alert_mutes" ADD CONSTRAINT "alert_mutes_check"
  CHECK ("until" > "created_at"
         AND char_length("reason") BETWEEN 10 AND 500
         AND ("rule" IS NULL OR "rule" ~ '^[a-z][a-z0-9_]{0,63}$')
         AND ("ended_at" IS NULL) = ("ended_by_id" IS NULL));

ALTER TABLE "detection_rule_settings" ADD CONSTRAINT "detection_rule_settings_check"
  CHECK ("rule" ~ '^[a-z][a-z0-9_]{0,63}$' AND jsonb_typeof("params") = 'object'
         AND octet_length("params"::text) <= 4096);

ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_check"
  CHECK ("first_after_minutes" BETWEEN 1 AND 10080
         AND "repeat_every_minutes" BETWEEN 5 AND 10080
         AND "max_escalations" BETWEEN 1 AND 10
         AND "channels" IS NOT NULL AND "channels" <@ ARRAY['email', 'chat']::text[]);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_check"
  CHECK (jsonb_typeof("preferences") = 'object' AND octet_length("preferences"::text) <= 8192);

-- The policies the escalation job reads: critical and high escalate by
-- default (email and the chat channels); the others do not.
INSERT INTO "escalation_policies"
  ("severity", "enabled", "first_after_minutes", "repeat_every_minutes", "max_escalations", "channels", "updated_at")
VALUES
  ('critical', true, 15, 30, 3, ARRAY['email', 'chat'], now()),
  ('high', true, 60, 120, 2, ARRAY['email', 'chat'], now()),
  ('medium', false, 240, 480, 1, ARRAY['chat'], now()),
  ('low', false, 1440, 1440, 1, ARRAY['chat'], now()),
  ('info', false, 1440, 1440, 1, ARRAY['chat'], now());

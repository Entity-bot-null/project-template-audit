-- Access by application and second factors (docs/adr/0012). The sessions
-- table and the users table (foreign keys) are busy: the statements give
-- up after 5 seconds instead of queueing every request behind them.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfa_verified_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_app_assignments" (
    "user_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_app_assignments_pkey" PRIMARY KEY ("user_id","app_id")
);

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" BYTEA NOT NULL,
    "enc_key_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "filters" JSONB NOT NULL,
    "format" TEXT NOT NULL,
    "row_cap" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "row_count" INTEGER,
    "digest" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" JSONB,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_app_assignments_app_id_idx" ON "user_app_assignments"("app_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_factors_user_id_key" ON "mfa_factors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_token_hash_key" ON "mfa_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");

-- CreateIndex
CREATE INDEX "mfa_challenges_expires_at_idx" ON "mfa_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_id_started_at_idx" ON "export_jobs"("requested_by_id", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs"("job", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "user_app_assignments" ADD CONSTRAINT "user_app_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_app_assignments" ADD CONSTRAINT "user_app_assignments_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── What Prisma does not express (schema.prisma comments) ──────────────────
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_check" CHECK (
    "purpose" IN ('verify', 'enroll') AND "attempts" BETWEEN 0 AND 10
    AND "token_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_step_check" CHECK ("last_used_step" IS NULL OR "last_used_step" >= 0);
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_check" CHECK (
    "format" IN ('csv', 'jsonl') AND "status" IN ('running', 'completed', 'truncated', 'failed')
    AND "row_cap" BETWEEN 1 AND 1000000 AND ("row_count" IS NULL OR "row_count" >= 0));
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_outcome_check" CHECK (
    "outcome" IN ('running', 'succeeded', 'failed', 'skipped')
    AND (("outcome" = 'running') = ("finished_at" IS NULL)));

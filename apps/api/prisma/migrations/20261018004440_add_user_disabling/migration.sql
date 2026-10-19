-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "removed_at" TIMESTAMPTZ(3);

-- A removed account stays disabled for good. New columns, all null: nothing to
-- validate, so the check is added valid at once.
ALTER TABLE "users" ADD CONSTRAINT "users_removed_disabled_check"
  CHECK ("removed_at" IS NULL OR "disabled_at" IS NOT NULL);

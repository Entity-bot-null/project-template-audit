-- The applications an invited auditor or viewer will see, assigned when the
-- invitation is accepted: without one, the account could not sign in to the
-- panel (auth/panel-access.ts). A new, empty table: nothing to backfill.

-- CreateTable
CREATE TABLE "invitation_apps" (
    "invitation_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,

    CONSTRAINT "invitation_apps_pkey" PRIMARY KEY ("invitation_id","app_id")
);

-- CreateIndex
CREATE INDEX "invitation_apps_app_id_idx" ON "invitation_apps"("app_id");

-- AddForeignKey
ALTER TABLE "invitation_apps" ADD CONSTRAINT "invitation_apps_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_apps" ADD CONSTRAINT "invitation_apps_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "connected_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

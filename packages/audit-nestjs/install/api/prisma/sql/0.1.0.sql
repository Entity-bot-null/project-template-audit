-- audit-connector 0.1.0 (pnpm connector add; docs/audit/connection-guide.md)
-- What Prisma's schema does not express for the connector's tables.
ALTER TABLE "audit_outbox_state" ADD CONSTRAINT "audit_outbox_state_single_row" CHECK ("id" = 1 AND "last_seq" >= 0);
ALTER TABLE "audit_outbox" ADD CONSTRAINT "audit_outbox_attempts_check" CHECK ("attempts" >= 0);
-- The forwarder numbers rows in id order, unnumbered first.
CREATE INDEX "audit_outbox_unsequenced_idx" ON "audit_outbox" ("id") WHERE "source_seq" IS NULL;
CREATE INDEX "audit_outbox_due_idx" ON "audit_outbox" ("next_attempt_at", "source_seq") WHERE "source_seq" IS NOT NULL;
ALTER TABLE "audit_security_prompts" ADD CONSTRAINT "audit_security_prompts_answer_check"
  CHECK (("answer" IS NULL) = ("answered_at" IS NULL) AND ("answer" IS NULL OR "answer" IN ('confirmed', 'not_me')));
-- audit-connector:end

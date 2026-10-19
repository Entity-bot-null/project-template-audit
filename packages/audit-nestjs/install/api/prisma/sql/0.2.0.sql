-- audit-connector 0.2.0 (pnpm connector add or update; docs/audit/connection-guide.md)
-- What Prisma's schema does not express for the tables this version adds.
ALTER TABLE "audit_push_tokens" ADD CONSTRAINT "audit_push_tokens_platform_check" CHECK ("platform" IN ('ios', 'android'));
-- audit-connector:end

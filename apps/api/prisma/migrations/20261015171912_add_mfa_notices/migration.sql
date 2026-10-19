-- Second factors (docs/adr/0012). A busy table never blocks the deployment
-- for long: the statements give up after 5 seconds instead of queueing every
-- request behind them.
SET lock_timeout = '5s';

-- The security notice of a second factor set up, reset or used with a
-- recovery code. Adding an enum value is an expand step.
ALTER TYPE "MailKind" ADD VALUE 'mfa_changed';

-- A challenge remembers the account's securityVersion when the password was
-- checked: a new password or a reset since voids it. A constant default:
-- no table rewrite.
ALTER TABLE "mfa_challenges" ADD COLUMN "security_version" INTEGER NOT NULL DEFAULT 0;

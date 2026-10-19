-- The IP is stored in the text form Audit Hub canonicalizes, which the
-- satellite row's digest covers: inet would rewrite it on the way in (the
-- verifier would read another text than the one hashed).
-- contract: no release has written event_personal yet; it was created in the same release
ALTER TABLE "event_personal" ALTER COLUMN "ip" SET DATA TYPE TEXT;

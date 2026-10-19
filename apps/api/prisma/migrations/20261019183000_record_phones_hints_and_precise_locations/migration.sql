-- The actor's phone, masked at the origin (its last four digits), and the
-- request's client hints: personal data, kept and erased with the rest of the
-- row. New nullable columns: a row without them hashes as before
-- (personalDigestDocument leaves them out).
ALTER TABLE "event_personal" ADD COLUMN "actor_phone" TEXT,
ADD COLUMN "client_hints" JSONB;

-- Device coordinates: two decimals for an approximate position, five for a
-- precise one (consent to the precise position). Every row so far has two.
ALTER TABLE "event_locations" ADD COLUMN "coordinate_decimals" SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_coordinate_decimals_check"
  CHECK ("coordinate_decimals" IN (2, 5));

-- A wider DECIMAL keeps every stored value (19.43 stays 19.43000), and the
-- verifier reads each row at its own coordinate_decimals: the digests of the
-- rows written so far still match. The table holds 30 days at most.
-- contract: widened, every stored latitude kept; each row's digest read at its own coordinate_decimals
ALTER TABLE "event_locations" ALTER COLUMN "latitude" SET DATA TYPE DECIMAL(7,5);
-- contract: widened, every stored longitude kept; each row's digest read at its own coordinate_decimals
ALTER TABLE "event_locations" ALTER COLUMN "longitude" SET DATA TYPE DECIMAL(8,5);

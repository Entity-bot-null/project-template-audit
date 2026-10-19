// Development only: the current code of the second factor the seed gives the
// development accounts (apps/api/src/seed/seed.ts), for signing in without an
// authenticator app. Another key as the argument: its code instead.
//   pnpm dev:totp [<base32 key>]
import { Secret, TOTP } from 'otpauth';

const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- the seed's public development key
const totp = new TOTP({ secret: Secret.fromBase32(process.argv[2] ?? SEED_TOTP_SECRET) });

const left = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Code: ${totp.generate()}  (valid ${String(left)} more seconds)`);
if (left < 10) {
  console.log(
    `Next: ${totp.generate({ timestamp: Date.now() + 30_000 })}  (from ${String(left)} s)`,
  );
}

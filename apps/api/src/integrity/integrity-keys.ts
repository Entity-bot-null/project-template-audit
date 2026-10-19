import { createHash, hkdfSync } from 'node:crypto';
import { env } from '../env/env.js';

// The keys that sign seals and checkpoints (docs/adr/0008): AUDIT_INTEGRITY_KEY
// signs and verifies, AUDIT_INTEGRITY_KEY_PREVIOUS only verifies. They never
// live in the database: whoever can edit the tables cannot re-sign them.

export interface IntegrityKey {
  /** Fingerprint stored with each seal: which key signed it. */
  id: string;
  key: Buffer;
}

export interface IntegrityKeyring {
  current: IntegrityKey;
  all: readonly IntegrityKey[];
  /** True outside production when AUDIT_INTEGRITY_KEY is unset. */
  fallback: boolean;
}

function derive(secret: string, info: string): IntegrityKey {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32));
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 16), key };
}

export function integrityKeyring(config: {
  key: string | undefined;
  previous: string | undefined;
  fallback: string;
}): IntegrityKeyring {
  const current =
    config.key === undefined
      ? derive(config.fallback, 'audit-hub/integrity/development-fallback/v1')
      : derive(config.key, 'audit-hub/integrity/v1');
  const all = [current];
  if (config.previous !== undefined) all.push(derive(config.previous, 'audit-hub/integrity/v1'));
  return { current, all, fallback: config.key === undefined };
}

export function integrityKeyringFromEnv(): IntegrityKeyring {
  return integrityKeyring({
    key: env.AUDIT_INTEGRITY_KEY,
    previous: env.AUDIT_INTEGRITY_KEY_PREVIOUS,
    fallback: env.JWT_ACCESS_SECRET,
  });
}

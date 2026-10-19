import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

// The secrets Audit Hub must use again later (an application's signing key
// to verify its requests, a webhook secret to sign deliveries, a
// pseudonymization key, a second factor) are stored encrypted with AES-256-GCM
// (docs/adr/0006). Hashing would not do: an HMAC cannot be verified with the
// hash of its key.
//
// Each ciphertext is bound to a context (the row and column it belongs to) as
// authenticated data: copied to another row, it no longer decrypts.
// Layout: version (1 byte) ‖ key id (16 hex characters) ‖ IV (12) ‖ tag (16) ‖
// ciphertext. The key id says which configured key opens it (rotation).

const VERSION = 1;
const KEY_ID_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KEY_ID_BYTES + IV_BYTES + TAG_BYTES;

export interface SecretKey {
  /** Fingerprint stored next to each ciphertext: which key decrypts it. */
  id: string;
  key: Buffer;
}

export class SecretBoxError extends Error {
  override readonly name = 'SecretBoxError';
}

/** A 32-byte key from a configured secret (HKDF), and its fingerprint. */
export function deriveSecretKey(secret: string, info: string): SecretKey {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32));
  const id = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return { id, key };
}

export class SecretBox {
  /** The first key encrypts; every key decrypts what it encrypted. */
  constructor(private readonly keys: readonly SecretKey[]) {
    if (keys.length === 0) throw new SecretBoxError('SecretBox needs at least one key');
  }

  get currentKeyId(): string {
    return this.current.id;
  }

  private get current(): SecretKey {
    const [first] = this.keys;
    if (first === undefined) throw new SecretBoxError('SecretBox needs at least one key');
    return first;
  }

  seal(
    plaintext: Uint8Array,
    context: string,
  ): { ciphertext: Uint8Array<ArrayBuffer>; keyId: string } {
    const { id, key } = this.current;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      // A copy in its own ArrayBuffer: what Prisma's Bytes fields take.
      ciphertext: new Uint8Array(
        Buffer.concat([Buffer.of(VERSION), Buffer.from(id), iv, cipher.getAuthTag(), body]),
      ),
      keyId: id,
    };
  }

  open(ciphertext: Uint8Array, context: string): Buffer {
    const data = Buffer.from(ciphertext);
    if (data.length < HEADER_BYTES || data[0] !== VERSION) {
      throw new SecretBoxError(`Malformed ciphertext for ${context}`);
    }
    const keyId = keyIdOf(data);
    const key = this.keys.find((candidate) => candidate.id === keyId);
    if (key === undefined) throw new SecretBoxError(`No configured key ${keyId} for ${context}`);
    let offset = 1 + KEY_ID_BYTES;
    const iv = data.subarray(offset, (offset += IV_BYTES));
    const tag = data.subarray(offset, (offset += TAG_BYTES));
    // The tag length is fixed: a shorter tag would weaken what authenticates.
    const decipher = createDecipheriv('aes-256-gcm', key.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data.subarray(offset)), decipher.final()]);
    } catch {
      throw new SecretBoxError(`Ciphertext for ${context} does not authenticate`);
    }
  }

  /** Whether a ciphertext was sealed with an older key (to re-encrypt it). */
  isStale(ciphertext: Uint8Array): boolean {
    return keyIdOf(Buffer.from(ciphertext)) !== this.current.id;
  }
}

function keyIdOf(data: Buffer): string {
  return data.subarray(1, 1 + KEY_ID_BYTES).toString('latin1');
}

/** Where the keys come from: AUDIT_SECRETS_KEY (+ _PREVIOUS), or a development fallback. */
export interface SecretBoxConfig {
  secret: string | undefined;
  previous: string | undefined;
  /** JWT_ACCESS_SECRET: the development fallback's material. */
  fallback: string;
}

const INFO = 'audit-hub/secret-box/v1';
const FALLBACK_INFO = 'audit-hub/secret-box/development-fallback/v1';

export function secretBoxFromConfig(config: SecretBoxConfig): {
  box: SecretBox;
  fallback: boolean;
} {
  const keys: SecretKey[] = [];
  if (config.secret === undefined) keys.push(deriveSecretKey(config.fallback, FALLBACK_INFO));
  else keys.push(deriveSecretKey(config.secret, INFO));
  if (config.previous !== undefined) keys.push(deriveSecretKey(config.previous, INFO));
  return { box: new SecretBox(keys), fallback: config.secret === undefined };
}

/** A key derived from the box's configuration for another purpose (recovery-code pepper). */
export function derivedKey(config: SecretBoxConfig, purpose: string): Buffer {
  return deriveSecretKey(config.secret ?? config.fallback, `audit-hub/${purpose}/v1`).key;
}

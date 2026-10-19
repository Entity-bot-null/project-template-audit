import { Secret } from 'otpauth';
import { normalizeEmail } from '../auth/auth.constants.js';
import { hashPassword } from '../auth/password.js';
import type { SecretBox } from '../common/crypto/secret-box.js';
import type { Role } from '../common/types/request-user.js';
import type { PrismaClient } from '../prisma/generated/client.js';

interface SeedUser {
  email: string;
  name: string;
  role: Role;
  password: string;
}

// Development, test and E2E accounts. The passwords are public on purpose:
// these accounts must never exist in production, and run.ts refuses to run
// with NODE_ENV=production.
export const SEED_USERS: readonly SeedUser[] = [
  { email: 'admin@example.com', name: 'Admin', role: 'admin', password: 'admin-password' },
  { email: 'auditor@example.com', name: 'Auditor', role: 'auditor', password: 'auditor-password' },
  { email: 'viewer@example.com', name: 'Viewer', role: 'viewer', password: 'viewer-password' },
  { email: 'member@example.com', name: 'Member', role: 'member', password: 'member-password' },
];

/**
 * Audit Hub (docs/adr/0012): every seed account has its second factor set up
 * with this TOTP secret, public like the passwords (base32, for an
 * authenticator app; the E2E suite computes codes from it).
 */
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // nosemgrep: generic.secrets.security.detected-generic-secret.detected-generic-secret -- public by design: development accounts only, the seed refuses production

/** The secret's bytes. */
export function seedTotpBytes(): Buffer {
  return Buffer.from(Secret.fromBase32(SEED_TOTP_SECRET).bytes);
}

/**
 * Idempotent: keyed on the email, a re-run resets name, role, password and
 * second factor (recovery codes: none; an administrator can reset a factor).
 */
export async function seed(prisma: PrismaClient, box: SecretBox): Promise<void> {
  for (const user of SEED_USERS) {
    const email = normalizeEmail(user.email);
    const passwordHash = await hashPassword(user.password);
    const { id } = await prisma.user.upsert({
      where: { email },
      create: { email, name: user.name, role: user.role, passwordHash },
      update: { name: user.name, role: user.role, passwordHash },
      select: { id: true },
    });
    const sealed = box.seal(seedTotpBytes(), `mfa_factors:${id}`);
    const factor = {
      secret: sealed.ciphertext,
      encKeyId: sealed.keyId,
      confirmedAt: new Date(),
      lastUsedStep: null,
    };
    await prisma.mfaFactor.upsert({
      where: { userId: id },
      create: { userId: id, ...factor },
      update: factor,
    });
  }
}

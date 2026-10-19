import { openDatabaseAsync } from 'expo-sqlite';

import { QUEUE_DATABASE } from '@/lib/audit/audit.constants';
import type { InstallationIdStore } from '@/lib/audit/audit.ports';
import { openAuditQueue } from '@/lib/audit/queue';

import { STORAGE_KEYS } from './index';
import { persistentStorage } from './persistentStorage';

// What the Audit Hub connector keeps on the device (SECURITY.md#storage).
// Created once by `pnpm connector add --kind expo`; the project's own code
// from then on.

/**
 * The device's audit events waiting to be sent: their own SQLite file, apart
 * from the key-value store, its tables the connector's (src/lib/audit/queue.ts).
 * One user's events at a time, at most a thousand, each deleted once the API
 * answers for it or the user signs out. Private to the app, not encrypted:
 * never a secret or a token, and a position only rounded and with consent.
 */
export const auditQueue = openAuditQueue(() => openDatabaseAsync(QUEUE_DATABASE));

/** This installation's random id (X-Device-Id), wiped by an uninstall like the rest of persistentStorage. */
export const auditInstallation: InstallationIdStore = {
  get: () => persistentStorage.getItem(STORAGE_KEYS.auditInstallation),
  set: (id) => persistentStorage.setItem(STORAGE_KEYS.auditInstallation, id),
};

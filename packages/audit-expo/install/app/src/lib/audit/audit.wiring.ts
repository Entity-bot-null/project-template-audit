import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Network from 'expo-network';
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';

import { auditTransport } from '@/api/audit';
import { setRequestHeaders } from '@/api/client';
import { session, useSessionStore } from '@/auth/session';
import { getPushToken, notificationPermission, type PushTokenRegistrar } from '@/lib/notifications';
import { logger } from '@/lib/observability';
import { isOnline } from '@/lib/query/network';
import { auditInstallation, auditQueue } from '@/lib/storage/auditQueue';

import type { AuditDependencies, AuditTriggers, DeviceFacts } from './audit.ports';
import { createAuditClient } from './audit-client';
import { createAuditHooks } from './hooks';

// The app's side of Audit Hub, wired once (Audit Hub's
// docs/audit/connection-guide.md#the-mobile-app): the API through src/api,
// the queue and the installation id through src/lib/storage, the device
// through the Expo modules. Created once by `pnpm connector add --kind expo`;
// the project's own code from then on.

const intl = Intl.DateTimeFormat().resolvedOptions();

/** What the phone says about itself: read once, it does not change while the app runs. */
const facts: DeviceFacts = {
  platform: Platform.OS,
  appVersion: Application.nativeApplicationVersion,
  appBuild: Application.nativeBuildVersion,
  updateId: Updates.updateId,
  os: Device.osName,
  osVersion: Device.osVersion,
  deviceModel: Device.modelName,
  locale: intl.locale,
  timeZone: intl.timeZone,
};

export const auditTriggers: AuditTriggers = {
  onForeground: (listener) => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') listener();
    });
    return () => {
      subscription.remove();
    };
  },
  onOnline: (listener) => {
    let online = true;
    const subscription = Network.addNetworkStateListener((state) => {
      const now = isOnline(state);
      if (now && !online) listener();
      online = now;
    });
    return () => {
      subscription.remove();
    };
  },
  every: (ms, task) => {
    const timer = setInterval(task, ms);
    return () => {
      clearInterval(timer);
    };
  },
};

export const auditDependencies: AuditDependencies = {
  transport: auditTransport,
  queue: auditQueue,
  installation: auditInstallation,
  device: {
    facts: () => facts,
    networkType: async () => (await Network.getNetworkStateAsync()).type ?? null,
  },
  triggers: auditTriggers,
  logger: {
    info: (message, data) => {
      logger.info('app', message, data);
    },
    warn: (message, data) => {
      logger.warn('app', message, data);
    },
  },
  random: (bytes) => Crypto.getRandomValues(bytes),
  signedIn: () => useSessionStore.getState().status === 'signedIn',
};

export const audit = createAuditClient(auditDependencies);

// Every request to the API says which app, build and installation sent it:
// the API's connector puts them in its own events (a sign-in from a phone the
// account never used is "new_device").
setRequestHeaders(() => audit.requestHeaders());

/** The account's security for the screens: activity and "Was it you?". */
export const {
  useAccountActivity,
  useSecurityPrompts,
  useSecurityPrompt,
  useAnswerSecurityPrompt,
} = createAuditHooks(auditTransport);

/**
 * Sign out, the Audit Hub way: the queue is sent and the phone's push token
 * forgotten while the session is still valid (three seconds at most), then
 * the session ends (session.signOut() clears the token before its listeners).
 */
export async function signOut(): Promise<void> {
  await audit.beforeSignOut();
  await session.signOut();
}

/** Where the phone's push token goes (src/lib/notifications): the API's push-token route. */
export const pushTokenRegistrar: PushTokenRegistrar = {
  register: (token) => audit.registerPushToken(token),
};

/**
 * After each sign-in and on a restored session: this phone's token, when the
 * user already allowed notifications. Never asks for the permission.
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!(await notificationPermission.get()).granted) return;
    const token = await getPushToken();
    if (token !== null) await pushTokenRegistrar.register(token);
  } catch (error) {
    logger.warn('app', 'Push token not registered', { error: String(error) });
  }
}

/** A link the app refused to open (src/lib/links.ts): probing or phishing shows in Audit Hub. */
export function recordRejectedLink(): void {
  audit.record({ action: 'client.link.rejected' }).catch(() => undefined);
}

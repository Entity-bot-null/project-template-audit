import type { Alert } from '../types';

// The browser's own notices of alerts (the Notification API), while a tab of
// the panel is open: asked for only from a click of the person, refused or
// unavailable without breaking anything (the panel keeps its own notices).
// A notice says what the alert's row says: its severity, application and
// title (ids and counts, never a name, an email or an address).

export type NoticePermission = NotificationPermission | 'unsupported';

const supported = () => typeof Notification === 'function';

export function noticePermission(): NoticePermission {
  return supported() ? Notification.permission : 'unsupported';
}

/** From a click: asks the browser; answers what it allows now. */
export async function requestNoticePermission(): Promise<NoticePermission> {
  if (!supported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** The words of a notice: the alert's row, nothing more. */
export function noticeOf(alert: Pick<Alert, 'severity' | 'appSlug' | 'title'>): {
  title: string;
  body: string;
} {
  return {
    title: `${alert.severity.toUpperCase()} alert · ${alert.appSlug}`,
    body: alert.title.slice(0, 180),
  };
}

/**
 * Shows a notice of `alert` (one per alert: a later one replaces it); a click
 * brings the panel forward on the alert. False when the browser does not allow it.
 */
export function showNotice(alert: Alert, open: (alertId: string) => void): boolean {
  if (noticePermission() !== 'granted') return false;
  try {
    const { title, body } = noticeOf(alert);
    const notice = new Notification(title, {
      body,
      tag: `audit-hub-alert:${alert.id}`,
      requireInteraction: alert.severity === 'critical',
    });
    notice.onclick = () => {
      window.focus();
      open(alert.id);
      notice.close();
    };
    return true;
  } catch {
    return false;
  }
}

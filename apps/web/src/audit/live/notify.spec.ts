import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '../types';
import { noticeOf, noticePermission, requestNoticePermission, showNotice } from './notify';

const alert = {
  id: '0190b6a1-0000-7000-8000-0000000000b1',
  severity: 'critical',
  appSlug: 'shop',
  title: 'Many failed sign-ins',
  subject: 'user-42',
  subjectLabel: 'Ann Example',
} as Alert;

/** A Notification class with this permission; the notices it made. */
function stubNotification(permission: NotificationPermission, answer = permission) {
  const made: {
    title: string;
    options: NotificationOptions;
    close: () => void;
    onclick: (() => void) | null;
  }[] = [];
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(() => Promise.resolve(answer));
    onclick: (() => void) | null = null;
    close = vi.fn();
    constructor(title: string, options: NotificationOptions) {
      made.push(this as never);
      Object.assign(this, { title, options });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return { made, FakeNotification };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser notices', () => {
  it("say the alert's severity, application and title: never who it is about", () => {
    const { title, body } = noticeOf(alert);
    expect(title).toBe('CRITICAL alert · shop');
    expect(body).toBe('Many failed sign-ins');
    expect(`${title} ${body}`).not.toMatch(/Ann|user-42/);
    expect(noticeOf({ ...alert, title: 'x'.repeat(400) }).body).toHaveLength(180);
  });

  it('show nothing when the browser has no notices or the person refused them', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(noticePermission()).toBe('unsupported');
    await expect(requestNoticePermission()).resolves.toBe('unsupported');
    expect(showNotice(alert, vi.fn())).toBe(false);

    const { made } = stubNotification('denied');
    expect(showNotice(alert, vi.fn())).toBe(false);
    expect(made).toHaveLength(0);
  });

  it('ask the browser only when requested, and answer what it allows', async () => {
    const { FakeNotification } = stubNotification('default', 'granted');
    expect(noticePermission()).toBe('default');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await expect(requestNoticePermission()).resolves.toBe('granted');
  });

  it('show one notice per alert, kept for a critical one; a click opens the alert', () => {
    const { made } = stubNotification('granted');
    const open = vi.fn();
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);

    expect(showNotice(alert, open)).toBe(true);
    expect(made[0]?.options).toEqual({
      body: 'Many failed sign-ins',
      tag: `audit-hub-alert:${alert.id}`,
      requireInteraction: true,
    });
    made[0]?.onclick?.();
    expect(open).toHaveBeenCalledWith(alert.id);
    expect(made[0]?.close).toHaveBeenCalled();
  });

  it('never throws when the browser refuses to show one', () => {
    stubNotification('granted');
    vi.stubGlobal(
      'Notification',
      Object.assign(
        function Broken() {
          throw new TypeError('Illegal constructor');
        },
        { permission: 'granted' },
      ),
    );
    expect(showNotice(alert, vi.fn())).toBe(false);
  });
});

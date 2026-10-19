import { describe, expect, it } from 'vitest';
import { deviceLabel, type ExplainedAlert, explainAlert } from './alert-explanation.js';

const AT = new Date('2026-10-15T12:00:00.000Z');
const NAMES = new Map([
  ['user-1', 'Ada Lovelace'],
  ['admin-1', 'Grace Hopper'],
]);

const alert = (
  rule: string,
  summary: Record<string, unknown>,
  subject: string | null = 'user-1',
): ExplainedAlert => ({ rule, subject, summary, lastSeenAt: AT });

const saw = (explained: ExplainedAlert, names: ReadonlyMap<string, string> = NAMES) =>
  explainAlert(explained, names).saw;

describe('explainAlert', () => {
  it('tells each signal of a suspicious sign-in, with the figures the rule kept', () => {
    const explained = explainAlert(
      alert('suspicious_sign_in', {
        signals: [
          'new_device',
          'new_country',
          'impossible_travel',
          'hosting_ip',
          'location_mismatch',
        ],
        browser: 'Microsoft Edge',
        os: 'Linux',
        country: 'ES',
        travelKm: 9050,
        travelMinutes: 125,
        travelSpeedKmh: 4344,
        mismatchKm: 9040,
      }),
      NAMES,
    );
    expect(explained.looksFor).toMatch(/^A successful sign-in unlike the account's usual ones/);
    expect(explained.saw).toEqual([
      'Ada Lovelace (user-1) signed in successfully.',
      'New device: one this account had not used before (Microsoft Edge on Linux).',
      'New country: one this account had not signed in from before (Spain (ES)).',
      'Impossible travel: 9,050 km from where the account was 2 hours before, 4,344 km/h (faster than an airliner).',
      'Hosting address: one of a hosting provider (a server, a VPN or a proxy), not of a home, an office or a phone network.',
      'Location mismatch: the device said it was 9,040 km from where its address is.',
    ]);
  });

  it('says less, never wrong, when an alert raised before the figures were kept lacks them', () => {
    expect(
      saw(
        alert(
          'suspicious_sign_in',
          {
            signals: [
              'new_device',
              'new_country',
              'impossible_travel',
              'location_mismatch',
              'odd_one',
              7,
            ],
          },
          null,
        ),
        new Map(),
      ),
    ).toEqual([
      'An unknown user signed in successfully.',
      'New device: one this account had not used before.',
      'New country: one this account had not signed in from before.',
      'Impossible travel: too far from where the account was shortly before to have got there (faster than 900 km/h).',
      'Location mismatch: the device said it was more than 500 km from where its address is.',
      'Odd one.',
    ]);
    expect(
      saw(alert('suspicious_sign_in', { signals: 'new_device', subject: 'user-2' }, null)),
    ).toEqual(['User user-2 signed in successfully.']);
  });

  it('names a phone by its model, a browser on its system, or whichever is known', () => {
    expect(deviceLabel({ deviceModel: 'Pixel 9', browser: 'Chrome', os: 'Android' })).toBe(
      'Pixel 9',
    );
    expect(deviceLabel({ browser: 'Firefox', os: 'Windows' })).toBe('Firefox on Windows');
    expect(deviceLabel({ os: 'macOS' })).toBe('macOS');
    expect(deviceLabel({ browser: '', os: null })).toBeUndefined();
  });

  it('says how long a span was as a person would', () => {
    const travel = (minutes: number) =>
      saw(
        alert('suspicious_sign_in', {
          signals: ['impossible_travel'],
          travelKm: 1000,
          travelMinutes: minutes,
          travelSpeedKmh: 1000,
        }),
      )[1];
    expect(travel(1)).toContain('1 minute before');
    expect(travel(90)).toContain('90 minutes before');
    expect(travel(600)).toContain('10 hours before');
    expect(travel(3 * 24 * 60)).toContain('3 days before');
  });

  it('shows a country code that is not a region as it came', () => {
    expect(saw(alert('suspicious_sign_in', { signals: ['new_country'], country: 'XX' }))[1]).toBe(
      'New country: one this account had not signed in from before (XX).',
    );
    expect(saw(alert('suspicious_sign_in', { signals: ['new_country'], country: 'zz1' }))[1]).toBe(
      'New country: one this account had not signed in from before (zz1).',
    );
  });

  it('tells how long a dormant account was away, from its figure or its last activity', () => {
    expect(
      saw(alert('dormant_account', { lastSeenAt: '2026-06-01T08:00:00.000Z', daysAway: 136 })),
    ).toEqual([
      'Ada Lovelace (user-1) signed in after 136 days without activity (last active on 2026-06-01).',
    ]);
    expect(saw(alert('dormant_account', { lastSeenAt: '2026-07-01T12:00:00.000Z' }))).toEqual([
      'Ada Lovelace (user-1) signed in after 106 days without activity (last active on 2026-07-01).',
    ]);
    expect(saw(alert('dormant_account', { lastSeenAt: 'not a date' }))).toEqual([
      'Ada Lovelace (user-1) signed in after a long time without activity.',
    ]);
    expect(saw(alert('dormant_account', {}))).toEqual([
      'Ada Lovelace (user-1) signed in after a long time without activity.',
    ]);
  });

  it('tells session reuse and privilege changes, with who did them', () => {
    expect(saw(alert('session_reuse', { subject: 'user-1' }))).toEqual([
      'A replaced session token of Ada Lovelace (user-1) was presented again.',
    ]);
    expect(
      saw(alert('privilege_change', { changedBy: 'admin-1', action: 'user.role_changed' })),
    ).toEqual([
      'Grace Hopper (admin-1) changed the privileges of Ada Lovelace (user-1) (user.role_changed).',
    ]);
    expect(saw(alert('privilege_change', { changedBy: 'user-1' }))).toEqual([
      'Ada Lovelace (user-1) changed their own privileges.',
    ]);
    expect(saw(alert('privilege_change', {}), new Map())).toEqual([
      'An unknown user changed the privileges of user user-1.',
    ]);
  });

  it('tells failed sign-ins of an account, also one known only by its email pseudonym', () => {
    const explained = explainAlert(alert('brute_force_account', { failures: 12 }), NAMES);
    expect(explained).toEqual({
      looksFor:
        '10 or more failed sign-ins of one account within 15 minutes: someone guessing its password.',
      saw: ['12 failed sign-ins of Ada Lovelace (user-1) within 15 minutes.'],
    });
    expect(saw(alert('brute_force_account', { failures: 1 }, null))).toEqual([
      "1 failed sign-in of one account (known here only by its email address's pseudonym) within 15 minutes.",
    ]);
    expect(saw(alert('brute_force_account', {}))).toEqual([
      'Failed sign-ins of Ada Lovelace (user-1) within 15 minutes.',
    ]);
  });

  it('tells attacks from one address, which the alert keeps only as a pseudonym', () => {
    expect(
      explainAlert(alert('brute_force_ip', { failures: 25, accounts: 1, source: 'abc123' }, null)),
    ).toEqual({
      looksFor: '20 or more failed sign-ins from one address within 15 minutes.',
      saw: [
        '25 failed sign-ins of 1 account from one address within 15 minutes.',
        'The alert keeps only a pseudonym of the address (abc123); each event behind it has the address itself while it is kept.',
      ],
    });
    const stuffing = explainAlert(
      alert('credential_stuffing', { failures: 40, accounts: 12 }, null),
    );
    expect(stuffing.looksFor).toBe(
      'Sign-ins of 10 or more accounts failing from one address within 15 minutes: someone trying leaked passwords.',
    );
    expect(stuffing.saw).toEqual([
      '40 failed sign-ins of 12 accounts from one address within 15 minutes.',
    ]);
    expect(saw(alert('credential_stuffing', {}, null))).toEqual([
      'Failed sign-ins from one address within 15 minutes.',
    ]);
    expect(
      explainAlert(
        alert('multi_app_attack', { failures: 6, applications: 3, source: 'abc123' }, null),
      ),
    ).toEqual({
      looksFor:
        'One address failing 5 or more sign-ins against 2 or more connected applications within 15 minutes (those that share their signals).',
      saw: [
        '6 failed sign-ins in this application from one address that fails against 3 connected applications in all.',
        'The alert keeps only a pseudonym of the address (abc123); each event behind it has the address itself while it is kept.',
      ],
    });
    expect(saw(alert('multi_app_attack', {}, null))).toEqual([
      'Failed sign-ins in this application from one address that fails against other applications too.',
    ]);
  });

  it('tells bulk exports, deletions and reads by one user', () => {
    expect(explainAlert(alert('mass_export', { count: 6 }), NAMES)).toEqual({
      looksFor: '5 or more bulk exports by one user within 15 minutes.',
      saw: ['6 bulk exports by Ada Lovelace (user-1) within 15 minutes.'],
    });
    expect(explainAlert(alert('mass_delete', { count: 1 }), NAMES)).toEqual({
      looksFor: '3 or more bulk deletions by one user within 15 minutes.',
      saw: ['1 bulk deletion by Ada Lovelace (user-1) within 15 minutes.'],
    });
    expect(explainAlert(alert('mass_read', {}), NAMES)).toEqual({
      looksFor: "50 or more reads of other users' data by one user within 15 minutes.",
      saw: ["Reads of other users' data by Ada Lovelace (user-1) within 15 minutes."],
    });
  });

  it('tells one session used by several accounts', () => {
    expect(
      explainAlert(alert('token_reuse', { accounts: 2, session: '0123456789abcdef' }, null)),
    ).toEqual({
      looksFor:
        'One session used by 2 or more accounts within an hour: a session stolen or shared.',
      saw: ['2 accounts used the same session (reference 0123456789abcdef…) within an hour.'],
    });
    expect(saw(alert('token_reuse', {}, null))).toEqual([
      'Several accounts used the same session within an hour.',
    ]);
  });

  it('says nothing it does not know of a rule of another version', () => {
    expect(explainAlert(alert('future_rule', { anything: 1 }))).toEqual({
      looksFor: null,
      saw: [],
    });
  });
});

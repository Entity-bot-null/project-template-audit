import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../auth';
import { resetForTests, setSession } from '../../auth/session';
import { formatDateTime, formatWhen } from '../../audit/format';
import type { EventDetail, EventSummary } from '../../audit/types';
import {
  bareEvent,
  EVENT_ID,
  eventSummary,
  fullEvent,
  OCCURRED,
  RECORDED,
  SHOP,
  VERIFIED,
} from '../../test/events';
import { failure, ok, stubFetch } from '../../test/http';
import { renderRoute } from '../../test/render';

const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};

const ID = EVENT_ID;
const full = fullEvent;
const bare = bareEvent;
const related = eventSummary();
const route = (id: string) => `GET /api/events/${id}`;

function answering(event: EventDetail, id = ID) {
  return stubFetch({ [route(id)]: () => ok(event) });
}

const section = (name: string) => screen.getByRole('region', { name });

/** The value next to a label in a section's facts. */
function fact(sectionName: string, label: string) {
  const term = within(section(sectionName)).getByText(label, { selector: 'dt' });
  return term.nextElementSibling as HTMLElement;
}

const heading = () => screen.findByRole('heading', { level: 1 });

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: viewer });
});
afterEach(() => {
  resetForTests();
});

describe('EventDetailPage', () => {
  it('shows every section of an event', async () => {
    const { calls } = answering(full);
    renderRoute(`/events/${ID}`);

    // The action in words, its key beneath.
    const title = await heading();
    expect(title).toHaveTextContent('A user changed their password.');
    expect(title.nextElementSibling).toHaveTextContent('user.password_changed');
    expect(new URL(calls[0]?.url ?? '').pathname).toBe(`/api/events/${ID}`);
    expect(screen.getByRole('link', { name: '← Events' })).toHaveAttribute('href', '/events');
    const badges = within(title.nextElementSibling?.nextElementSibling as HTMLElement);
    expect(badges.getByText('success')).toHaveClass('badge', 'outcome-success');
    expect(badges.getByText('medium · 35')).toHaveClass('badge', 'risk', 'sev-medium');
    expect(badges.getByText('shop')).toBeInTheDocument();
    expect(badges.getByText(formatWhen(OCCURRED))).toHaveClass('muted');
    expect(screen.queryByText(/is blocked since/)).not.toBeInTheDocument();

    expect(fact('Actor', 'Name')).toHaveTextContent('Ann Example');
    expect(fact('Actor', 'Phone')).toHaveTextContent(/^•••• 5678$/);
    expect(fact('Actor', 'Email')).toHaveTextContent(
      'Pseudonym only: Audit Hub never keeps addresses. ps_9f8e7d',
    );
    expect(within(fact('Actor', 'Id')).getByRole('link', { name: 'user-42' })).toHaveAttribute(
      'href',
      `/apps/${SHOP}/actors/user-42`,
    );
    expect(fact('Actor', 'Role')).toHaveTextContent('customer');
    expect(fact('Actor', 'Type')).toHaveTextContent('user');
    expect(fact('Actor', 'Acting for')).toHaveTextContent('support-1');
    expect(fact('Actor', 'Session')).toHaveTextContent('sess-55');

    const network = 'Network and location';
    expect(fact(network, 'IP address')).toHaveTextContent('203.0.113.5');
    expect(fact(network, 'Country')).toHaveTextContent('ES');
    expect(fact(network, 'Place')).toHaveTextContent('Alcalá Madrid');
    // The device's own coordinates, given with consent, before the IP's.
    expect(fact(network, 'Coordinates')).toHaveTextContent(
      `40.48, -3.36 (± 1,200 m, approximate, from the device, with consent, ${formatDateTime(OCCURRED)})`,
    );
    expect(fact(network, 'Address scope')).toHaveTextContent('public');
    expect(fact(network, 'ASN')).toHaveTextContent('3,352');
    expect(fact(network, 'User agent')).toHaveTextContent('Mozilla/5.0 (iPhone)');
    // A phone app's own report of its system and device; an app is no browser.
    expect(fact(network, 'Device')).toHaveTextContent('iPhone16,2 (mobile)');
    expect(fact(network, 'Device id')).toHaveTextContent('dev-abc');
    expect(fact(network, 'Operating system')).toHaveTextContent('iOS 18.1');
    expect(within(section(network)).queryByText('Browser')).toBeNull();

    expect(fact('Request', 'Route')).toHaveTextContent('/users/:id/password');
    expect(fact('Request', 'Method')).toHaveTextContent('POST');
    expect(fact('Request', 'Status')).toHaveTextContent('200');
    expect(fact('Request', 'Duration')).toHaveTextContent('1,520 ms');
    expect(fact('Request', 'Request id')).toHaveTextContent('req-123');
    expect(fact('Request', 'Trace id')).toHaveTextContent('4bf92f3577b34da6a3ce929d0e0e4736');

    expect(fact('Client', 'Type')).toHaveTextContent('ios');
    expect(fact('Client', 'App version')).toHaveTextContent('5.2.0 520');
    expect(fact('Client', 'Screen')).toHaveTextContent('SettingsScreen');
    expect(fact('Client', 'Locale')).toHaveTextContent('es-ES');
    expect(fact('Client', 'Time zone')).toHaveTextContent('Europe/Madrid');
    expect(fact('Client', 'Network')).toHaveTextContent('wifi');
    expect(fact('Client', 'SDK')).toHaveTextContent('audit-swift 1.4.0');
    expect(fact('Client', 'Declared by the client')).toHaveTextContent('appVersion');

    const audit = 'Audit and integrity';
    expect(fact(audit, 'Risk')).toHaveTextContent('35 / 100');
    expect(fact(audit, 'Severity')).toHaveTextContent('medium');
    expect(fact(audit, 'Category')).toHaveTextContent('security');
    expect(fact(audit, 'Outcome')).toHaveTextContent('success');
    expect(fact(audit, 'Reason')).toHaveTextContent('Forgot it');
    expect(fact(audit, 'Occurred')).toHaveTextContent(formatDateTime(OCCURRED));
    expect(fact(audit, 'Recorded')).toHaveTextContent(formatDateTime(RECORDED));
    expect(fact(audit, 'Sequence')).toHaveTextContent('3 / 1024');
    expect(fact(audit, 'Event id')).toHaveTextContent(full.eventId);
    expect(fact(audit, 'Sealed')).toHaveTextContent('yes, seal 42');
    expect(fact(audit, 'Last verified')).toHaveTextContent(formatDateTime(VERIFIED));
    expect(fact(audit, 'Content hash')).toHaveTextContent('ab'.repeat(32));
    expect(fact(audit, 'Seal hash')).toHaveTextContent('cd'.repeat(32));
    expect(fact(audit, 'Signature')).toHaveTextContent('c2lnbmF0dXJl');
    expect(fact(audit, 'Signing key')).toHaveTextContent('key-2026');

    expect(
      within(fact('Resource', 'Resource')).getByRole('link', { name: 'order ord-7' }),
    ).toHaveAttribute('href', `/apps/${SHOP}/resources/order/ord-7`);
    expect(fact('Resource', 'Name')).toHaveTextContent('Order 7');
    expect(fact('Resource', 'Inside')).toHaveTextContent('customer cus-9');

    // The JSON as highlighted code.
    const change = section('Change');
    expect(within(change).getByText('name, tags')).toBeInTheDocument();
    const [before, after] = within(change).getAllByRole('heading', { level: 3 });
    expect(before).toHaveTextContent('Before');
    expect(before?.nextElementSibling?.textContent).toBe(
      JSON.stringify(full.change.before, null, 2),
    );
    expect(after).toHaveTextContent('After');
    expect(after?.nextElementSibling?.textContent).toBe(JSON.stringify(full.change.after, null, 2));
    const details = section('Details');
    expect(within(details).getByText('"attempts"')).toHaveClass('json-key');
    expect(within(details).getByText('2')).toHaveClass('json-number');
    expect(within(details).getByText('true')).toHaveClass('json-boolean');

    expect(screen.getByText('Tags: credentials, account')).toBeInTheDocument();
    expect(
      screen.getByText('Truncated: userAgent · Dropped: extra · Flags: clock_skew'),
    ).toBeInTheDocument();

    const same = screen.getByRole('region', { name: 'Same request' });
    const table = within(same).getByRole('table', { name: 'Events with the same request id' });
    expect(within(table).getByText('An order changed.')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Application' })).toBeNull();
    expect(within(table).getByRole('button', { name: /^View details/ })).toBeInTheDocument();
  });

  it('reads the browser, the system and the device from the user agent of a web client', async () => {
    answering({
      ...full,
      clientType: 'web',
      client: { ...full.client, os: null, osVersion: null, deviceModel: null },
    });
    renderRoute(`/events/${ID}`);
    await heading();
    const network = 'Network and location';
    expect(fact(network, 'Browser')).toHaveTextContent(/^Safari 18\.1$/);
    expect(fact(network, 'Operating system')).toHaveTextContent(/^iOS 18\.1$/);
    expect(fact(network, 'Device')).toHaveTextContent(/^Apple iPhone \(mobile\)$/);
  });

  it('says a precise position from the device as such, with its five decimals', async () => {
    answering({
      ...full,
      location: { latitude: 19.43261, longitude: -99.13321, accuracyM: 5, capturedAt: OCCURRED },
    });
    renderRoute(`/events/${ID}`);
    await heading();
    expect(fact('Network and location', 'Coordinates')).toHaveTextContent(
      `19.43261, -99.13321 (± 5 m, precise, from the device, with consent, ${formatDateTime(OCCURRED)})`,
    );
  });

  it('places an event by its IP address when the device gave no coordinates', async () => {
    answering({ ...full, location: null });
    renderRoute(`/events/${ID}`);
    await heading();
    expect(fact('Network and location', 'Coordinates')).toHaveTextContent(
      '≈ 40.48, -3.36 (± 20 km, from the IP address)',
    );
  });

  it('says when the user of the event is blocked after an erasure, and only then', async () => {
    answering({ ...full, blockedSince: VERIFIED });
    renderRoute(`/events/${ID}`);
    await heading();
    expect(
      screen.getByText(
        `The user of this event is blocked since ${formatDateTime(VERIFIED)}, after an erasure: it is kept for the log, pseudonymous, and must not be used for that person.`,
      ),
    ).toHaveRole('status');
  });

  it('leaves out what was not recorded', async () => {
    answering(bare);
    renderRoute(`/events/${ID}`);
    // No description: the action's key is the title.
    expect(await heading()).toHaveTextContent('user.password_changed');

    const audit = 'Audit and integrity';
    expect(fact(audit, 'Risk')).toHaveTextContent('0 / 100');
    expect(within(section(audit)).queryByText('Reason')).toBeNull();
    expect(within(section(audit)).queryByText('Sequence')).toBeNull();
    expect(fact(audit, 'Sealed')).toHaveTextContent('not yet (within a minute)');
    expect(fact(audit, 'Last verified')).toHaveTextContent('—');
    expect(within(section(audit)).queryByText('Seal hash')).toBeNull();
    expect(
      within(section('Actor'))
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Type']);
    for (const name of ['Resource', 'Request', 'Client', 'Network and location']) {
      expect(within(section(name)).getByText('Nothing recorded.')).toBeInTheDocument();
    }
    expect(within(section('Network and location')).queryByText('Coordinates')).toBeNull();

    expect(screen.queryByRole('region', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Details' })).toBeNull();
    expect(screen.queryByText(/^Tags:/)).toBeNull();
    expect(screen.queryByText(/^(Truncated|Dropped|Flags):/)).toBeNull();
    expect(screen.queryByText('A user changed their password.')).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Same request' })).getByText('No events match.'),
    ).toBeInTheDocument();
  });

  it('says when the personal data is no longer kept', async () => {
    answering({ ...bare, personal: null, location: full.location, network: full.network });
    renderRoute(`/events/${ID}`);
    await heading();
    const network = section('Network and location');
    expect(
      within(network).getByText(
        'Its address, user agent and place are not kept any more: their retention period ended, or they were erased.',
      ),
    ).toBeInTheDocument();
    expect(within(network).queryByText('IP address')).toBeNull();
    // What is not personal stays, and the device's coordinates are kept apart.
    expect(fact('Network and location', 'Browser')).toHaveTextContent('Safari');
    expect(fact('Network and location', 'Coordinates')).toHaveTextContent(/^40.48, -3.36/);
  });

  it('shows a change without fields, partial places and quality, and a seal without a number', async () => {
    answering({
      ...bare,
      change: { before: { status: 'open' }, after: null, fields: [] },
      client: { ...bare.client, os: 'Android' },
      personal: { ...bare.personal!, city: null, subdivision: 'Bavaria', change: { email: 'x' } },
      quality: { truncatedFields: [], droppedFields: [], flags: ['late'] },
      integrity: { ...bare.integrity, sealed: true },
    });
    renderRoute(`/events/${ID}`);
    await heading();

    const change = section('Change');
    expect(within(change).queryByText(/^Fields:/)).toBeNull();
    const [before, after, personal] = within(change).getAllByRole('heading', { level: 3 });
    expect(before?.nextElementSibling?.textContent).toBe('{\n  "status": "open"\n}');
    expect(after?.nextElementSibling).toHaveTextContent('null');
    // The personal values of the change, kept like the rest of the personal data.
    expect(personal).toHaveTextContent('Personal values (kept 90 days)');
    expect(personal?.nextElementSibling).toHaveTextContent('"email": "x"');
    expect(fact('Network and location', 'Operating system')).toHaveTextContent(/^Android$/);
    expect(fact('Network and location', 'Place')).toHaveTextContent(/^Bavaria$/);
    expect(screen.getByText('Flags: late')).toBeInTheDocument();
    expect(fact('Audit and integrity', 'Sealed')).toHaveTextContent(/^yes, seal$/);
  });

  it('shows a change made of an after only, and quality without flags', async () => {
    answering({
      ...bare,
      change: { before: null, after: 'created', fields: [] },
      quality: { truncatedFields: [], droppedFields: ['extra', 'debug'], flags: [] },
    });
    renderRoute(`/events/${ID}`);
    await heading();
    const [before, after] = within(section('Change')).getAllByRole('heading', { level: 3 });
    expect(before?.nextElementSibling).toHaveTextContent('null');
    expect(after?.nextElementSibling).toHaveTextContent('"created"');
    expect(screen.getByText('Dropped: extra, debug')).toBeInTheDocument();
  });

  it('links only ids that are valid', async () => {
    answering({
      ...full,
      actor: { type: 'user', id: 'not an id', role: null, label: null },
      resource: { type: 'Order', id: 'ord-7' },
      related: [
        {
          ...related,
          id: 'not-a-uuid',
          actor: { type: 'user', id: null, role: null, label: null },
        },
      ],
    });
    renderRoute(`/events/${ID}`);
    await heading();

    expect(fact('Actor', 'Id')).toHaveTextContent('not an id');
    expect(within(fact('Actor', 'Id')).queryByRole('link')).toBeNull();
    expect(fact('Resource', 'Resource')).toHaveTextContent('Order ord-7');
    expect(within(fact('Resource', 'Resource')).queryByRole('link')).toBeNull();
    const table = screen.getByRole('table', { name: 'Events with the same request id' });
    expect(within(table).queryAllByRole('link')).toEqual([]);
  });

  it('answers not found for an id that is not an event id, without asking the API', async () => {
    const { fetchMock } = stubFetch({});
    renderRoute('/events/not-a-uuid');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a failure and retries', async () => {
    let attempt = 0;
    stubFetch({ [route(ID)]: () => (attempt++ === 0 ? failure(404, 'No such event') : ok(full)) });
    renderRoute(`/events/${ID}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await heading()).toHaveTextContent('A user changed their password.');
  });
});

// docs/adr/0014: every value of an event is text. Markup, template syntax,
// attribute breakouts and javascript: URLs come back as the characters they
// are, never as elements, handlers or links.
describe('EventDetailPage, hostile values', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>',
    '${alert(1)}',
    '" onmouseover="alert(1)',
    'javascript:alert(1)',
  ];

  function hostile(p: string): EventDetail {
    const summary: EventSummary = {
      id: p,
      eventId: p,
      appId: p,
      appSlug: p,
      recordedAt: p,
      occurredAt: p,
      category: p,
      action: p,
      description: p,
      outcome: p,
      severity: p,
      riskScore: 1,
      actor: { type: p, id: p, role: p, label: p },
      resource: { type: p, id: p },
      requestId: p,
      httpStatus: 500,
      clientType: p,
      country: p,
      ipScope: p,
    };
    return {
      ...summary,
      sequence: { epoch: p, seq: p },
      catalog: { description: p, tags: [p] },
      reason: p,
      actorDetail: { emailPseudonym: p, impersonatorId: p, sessionRef: p },
      parentResource: { type: p, id: p },
      change: { before: { [p]: p }, after: [p], fields: [p] },
      request: { method: p, route: p, traceId: p, durationMs: 1 },
      client: {
        appVersion: p,
        appBuild: p,
        os: p,
        osVersion: p,
        deviceModel: p,
        locale: p,
        timeZone: p,
        networkType: p,
        route: p,
        sdk: p,
        declared: [p],
      },
      network: { asn: 1, browser: p, os: p, deviceClass: p },
      details: { [p]: { nested: [p, p] }, href: p },
      personal: {
        ip: p,
        userAgent: p,
        agent: { browser: p, os: p, device: p },
        deviceId: p,
        actorLabel: p,
        actorPhone: p,
        resourceLabel: p,
        subdivision: p,
        city: p,
        approximateLocation: null,
        change: p,
      },
      location: null,
      quality: { truncatedFields: [p], droppedFields: [p], flags: [p] },
      integrity: {
        sealed: true,
        sealNo: p,
        verifiedAt: p,
        contentHash: p,
        seal: { hash: p, signature: p, keyId: p },
      },
      blockedSince: null,
      related: [summary],
    };
  }

  it.each(PAYLOADS)('shows %s as text, never as markup or a link', async (p) => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    answering(hostile(p));
    renderRoute(`/events/${ID}`);

    expect(await heading()).toHaveTextContent(p, { normalizeWhitespace: false });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(p);
    const network = 'Network and location';
    const audit = 'Audit and integrity';
    const exact: [string, string, string][] = [
      ['Actor', 'Name', p],
      ['Actor', 'Phone', p],
      ['Actor', 'Email', `Pseudonym only: Audit Hub never keeps addresses. ${p}`],
      ['Actor', 'Id', p],
      ['Actor', 'Role', p],
      ['Actor', 'Type', p],
      ['Actor', 'Acting for', p],
      ['Actor', 'Session', p],
      [network, 'IP address', p],
      [network, 'Country', p],
      [network, 'Place', `${p} ${p}`],
      [network, 'Address scope', p],
      [network, 'User agent', p],
      [network, 'Device', `${p} (${p})`],
      [network, 'Device id', p],
      [network, 'Operating system', `${p} ${p}`],
      [network, 'Browser', p],
      ['Request', 'Route', p],
      ['Request', 'Method', p],
      ['Request', 'Request id', p],
      ['Request', 'Trace id', p],
      ['Client', 'Type', p],
      ['Client', 'App version', `${p} ${p}`],
      ['Client', 'Screen', p],
      ['Client', 'Locale', p],
      ['Client', 'Time zone', p],
      ['Client', 'Network', p],
      ['Client', 'SDK', p],
      ['Client', 'Declared by the client', p],
      [audit, 'Severity', p],
      [audit, 'Category', p],
      [audit, 'Outcome', p],
      [audit, 'Reason', p],
      [audit, 'Occurred', p],
      [audit, 'Recorded', p],
      [audit, 'Sequence', `${p} / ${p}`],
      [audit, 'Sealed', `yes, seal ${p}`],
      [audit, 'Last verified', p],
      [audit, 'Content hash', p],
      [audit, 'Seal hash', p],
      [audit, 'Signature', p],
      [audit, 'Signing key', p],
      ['Resource', 'Resource', `${p} ${p}`],
      ['Resource', 'Name', p],
      ['Resource', 'Inside', `${p} ${p}`],
    ];
    for (const [sectionName, label, text] of exact) {
      expect(fact(sectionName, label).textContent, `${sectionName} / ${label}`).toBe(text);
    }
    expect(screen.getAllByText(p, { selector: '.badge' })).toHaveLength(2);
    expect(screen.getAllByText(`${p} · 1`, { selector: '.badge' })).toHaveLength(2);
    expect(screen.getAllByText(p, { selector: '.muted' }).length).toBeGreaterThan(0);
    expect(screen.getByText(`Tags: ${p}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Truncated: ${p} · Dropped: ${p} · Flags: ${p}`, { normalizer: (s) => s }),
    ).toBeInTheDocument();

    const quoted = JSON.stringify(p);
    const change = section('Change');
    expect(within(change).getByText(p, { selector: '.mono' })).toBeInTheDocument();
    expect(within(change).getByText(quoted, { selector: '.json-key' })).toBeInTheDocument();
    // Before, after, and its personal values.
    expect(within(change).getAllByText(quoted, { selector: '.json-string' })).toHaveLength(3);
    const details = section('Details');
    expect(within(details).getByText(quoted, { selector: '.json-key' })).toBeInTheDocument();
    expect(within(details).getAllByText(quoted, { selector: '.json-string' })).toHaveLength(3);

    const table = screen.getByRole('table', { name: 'Events with the same request id' });
    expect(within(table).getAllByText(p).length).toBeGreaterThanOrEqual(3);
    expect(within(table).getByText(`${p} · 1`)).toBeInTheDocument();

    // Nothing became markup, a handler or a link.
    const main = document.body;
    expect(main.querySelector('script')).toBeNull();
    expect(main.querySelector('a[href^="javascript"]')).toBeNull();
    for (const element of main.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.name.startsWith('on'), `${element.tagName} ${attribute.name}`).toBe(false);
        expect(attribute.value).not.toContain('alert(1)');
      }
    }
    // The only links in the page are the app's own: no value of the event is one.
    const hrefs = [...main.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs.filter((href) => !href?.startsWith('/'))).toEqual([]);
    expect(within(fact('Actor', 'Id')).queryByRole('link')).toBeNull();
    expect(within(fact('Resource', 'Resource')).queryByRole('link')).toBeNull();
    expect(within(table).queryAllByRole('link')).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it('never links a malicious actor id, even of a known application', async () => {
    answering({
      ...full,
      actor: { type: 'user', id: 'javascript:alert(1)', role: null, label: null },
      resource: { type: 'order', id: '<script>alert(1)</script>' },
    });
    renderRoute(`/events/${ID}`);
    await heading();
    expect(fact('Actor', 'Id').textContent).toBe('javascript:alert(1)');
    expect(within(fact('Actor', 'Id')).queryByRole('link')).toBeNull();
    expect(fact('Resource', 'Resource').textContent).toBe('order <script>alert(1)</script>');
    expect(within(fact('Resource', 'Resource')).queryByRole('link')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});

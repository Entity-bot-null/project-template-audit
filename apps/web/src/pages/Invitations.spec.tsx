import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConnectedApp } from '../audit/types';
import { resetCapabilitiesForTests } from '../auth/capabilities';
import { clearSession, getAccessToken, getState, resetForTests, setSession } from '../auth/session';
import { admin, member } from '../test/fixtures';
import {
  challenge,
  deferred,
  enrolled,
  enrollment,
  failure,
  json,
  ok,
  stubFetch,
} from '../test/http';
import { ENROLL, ENROLL_CONFIRM, setUpSecondFactor } from '../test/mfa';
import { renderRoute } from '../test/render';

// The administrators' invitations page, and the page an invitation's link
// opens.

const LIST = 'GET /api/admin/invitations';
const INVITE = 'POST /api/admin/invitations';
const CAPABILITIES = 'GET /api/auth/capabilities';
const ACCEPT = 'POST /api/auth/invitations/accept';
const APPS = 'GET /api/connected-apps';
const APP_ID = '0190b6a1-0000-7000-8000-0000000000a1';
const app = (
  id: string,
  name: string,
  status: ConnectedApp['status'] = 'active',
): ConnectedApp => ({
  id,
  slug: name.toLowerCase(),
  name,
  environment: 'production',
  status,
  webhookUrl: null,
  correlationEnabled: false,
  acceptedResponseActions: [],
  requireActionApproval: false,
  heartbeatTimeoutSec: 900,
  rateLimitPerMinute: 6000,
  createdAt: '2026-09-01T10:00:00.000Z',
  keys: [],
});
const apps = () =>
  ok([app(APP_ID, 'Shop'), app('0190b6a1-0000-7000-8000-0000000000a2', 'Legacy', 'retired')]);
const routeOf = (request: Request) => `${request.method} ${new URL(request.url).pathname}`;
const offers = (invitations: boolean) => () =>
  ok({ passwordReset: invitations, signUp: false, emailChange: invitations, invitations });
const pending = {
  id: '0190b6a1-0000-7000-8000-0000000000c1',
  email: 'katherine@example.com',
  role: 'viewer',
  apps: [{ appId: APP_ID, slug: 'shop', name: 'Shop' }],
  invitedBy: { id: admin.id, name: admin.name },
  createdAt: '2026-10-13T10:00:00.000Z',
  expiresAt: '2026-10-20T10:00:00.000Z',
};
const created = (email: string, role: string) =>
  json(201, { data: { ...pending, email, role, expiresAt: null }, message: 'Created' });

beforeEach(() => {
  resetForTests();
  resetCapabilitiesForTests();
});
afterEach(() => {
  resetForTests();
});

describe('AdminInvitationsPage', () => {
  beforeEach(() => {
    setSession({ accessToken: 'admin-token', expiresIn: 900, user: admin });
  });

  /** Fills the form (an admin by default) and sends it. */
  async function invite(email: string, role = 'admin', chosen: string[] = []) {
    const form = within(await screen.findByRole('form', { name: 'Invite someone' }));
    const user = userEvent.setup();
    if (email) await user.type(form.getByLabelText('Email'), email);
    await user.selectOptions(form.getByLabelText('Role'), role);
    for (const name of chosen) await user.click(await form.findByRole('checkbox', { name }));
    await user.click(form.getByRole('button', { name: 'Send invitation' }));
    return form;
  }

  it('is linked for admins, and lists the pending invitations', async () => {
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [pending], total: 1 }),
    });
    renderRoute('/');
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Invitations' }));
    expect(await screen.findByRole('cell', { name: pending.email })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: admin.name })).toBeInTheDocument();
  });

  it('sends an invitation with the chosen role, then loads the list again', async () => {
    let lists = 0;
    const { calls } = stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => {
        lists += 1;
        return ok({ items: [], total: 0 });
      },
      [INVITE]: () => created('grace@example.com', 'admin'),
    });
    renderRoute('/admin/invitations');
    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument();
    const form = await invite(' grace@example.com ', 'admin');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to grace@example.com.',
    );
    const sent = calls.find((call) => routeOf(call) === INVITE);
    await expect(sent?.json()).resolves.toEqual({
      email: 'grace@example.com',
      role: 'admin',
      appIds: [],
    });
    expect(sent?.headers.get('Authorization')).toBe('Bearer admin-token');
    await expect.poll(() => lists).toBe(2);
    expect(form.getByLabelText('Email')).toHaveValue('');
  });

  it('keeps the list on screen, marked busy, while it loads again', async () => {
    const reload = deferred<Response>();
    let lists = 0;
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => (lists++ === 0 ? ok({ items: [pending], total: 1 }) : reload.promise),
      [INVITE]: () => created('grace@example.com', 'admin'),
    });
    renderRoute('/admin/invitations');
    expect(await screen.findByRole('cell', { name: pending.email })).toBeInTheDocument();
    await invite('grace@example.com');
    await expect.poll(() => lists).toBe(2);
    // No loading message in its place: the previous rows, busy.
    expect(screen.queryByText('Loading invitations…')).toBeNull();
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    reload.resolve(ok({ items: [], total: 0 }));
    expect(await screen.findByText('No pending invitations.')).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('checks the address before calling the API', async () => {
    const { calls } = stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [], total: 0 }),
    });
    renderRoute('/admin/invitations');
    const form = await invite('not-an-email');
    expect(form.getByText('Enter a valid email.')).toBeInTheDocument();
    expect(calls.map(routeOf).filter((route) => route === INVITE)).toEqual([]);
  });

  it('sends a viewer or an auditor with the applications chosen, still in service; asks for one first', async () => {
    const { calls } = stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [], total: 0 }),
      [INVITE]: () => created('grace@example.com', 'auditor'),
    });
    renderRoute('/admin/invitations');
    const form = await invite('grace@example.com', 'auditor');
    expect(form.getByText('Choose at least one application.')).toBeInTheDocument();
    expect(calls.map(routeOf).filter((route) => route === INVITE)).toEqual([]);
    // A retired application is not offered.
    expect(form.queryByRole('checkbox', { name: /Legacy/ })).toBeNull();
    await userEvent.setup().click(form.getByRole('checkbox', { name: 'Shop (production)' }));
    expect(form.queryByText('Choose at least one application.')).toBeNull();
    await userEvent.setup().click(form.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent');
    await expect(calls.find((call) => routeOf(call) === INVITE)?.json()).resolves.toEqual({
      email: 'grace@example.com',
      role: 'auditor',
      appIds: [APP_ID],
    });
  });

  it('tells an admin needs no application', async () => {
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [], total: 0 }),
    });
    renderRoute('/admin/invitations');
    const form = within(await screen.findByRole('form', { name: 'Invite someone' }));
    await userEvent.setup().selectOptions(form.getByLabelText('Role'), 'admin');
    expect(form.getByText('An admin sees every application.')).toBeInTheDocument();
    expect(form.queryByRole('checkbox')).toBeNull();
  });

  it('marks an invitation that no longer opens the panel, and offers only to revoke it', async () => {
    const dead = { ...pending, role: 'member', apps: [] };
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [dead], total: 1 }),
    });
    renderRoute('/admin/invitations');
    expect(await screen.findByText(/Cannot be accepted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Send again to ${pending.email}` })).toBeNull();
    expect(
      screen.getByRole('button', { name: `Revoke the invitation to ${pending.email}` }),
    ).toBeEnabled();
  });

  it.each([
    [400, 'appIds: choose the applications', 'needs at least one application'],
    [404, 'Application not found', 'no longer available'],
  ])('explains a %i about the applications', async (status, message, shown) => {
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [], total: 0 }),
      [INVITE]: () => failure(status, message),
    });
    renderRoute('/admin/invitations');
    await invite('grace@example.com', 'viewer', ['Shop (production)']);
    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
  });

  it.each([
    [409, 'already has an account'],
    [429, 'got a message moments ago'],
    [503, 'Email is off here'],
    [500, 'The service is unavailable'],
  ])('explains a %i', async (status, shown) => {
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [], total: 0 }),
      [INVITE]: () => failure(status, 'refused'),
    });
    renderRoute('/admin/invitations');
    await invite('grace@example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent(shown);
  });

  it('sends one again and revokes one, by row', async () => {
    let revoked = false;
    const { calls } = stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok(revoked ? { items: [], total: 0 } : { items: [pending], total: 1 }),
      [INVITE]: () => created(pending.email, 'viewer'),
      [`DELETE /api/admin/invitations/${pending.id}`]: () => {
        revoked = true;
        return new Response(null, { status: 204 });
      },
    });
    renderRoute('/admin/invitations');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: `Send again to ${pending.email}` }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      `Invitation sent to ${pending.email}.`,
    );
    await expect(calls.find((call) => routeOf(call) === INVITE)?.json()).resolves.toEqual({
      email: pending.email,
      role: 'viewer',
      appIds: [APP_ID],
    });
    await user.click(
      await screen.findByRole('button', { name: `Revoke the invitation to ${pending.email}` }),
    );
    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Invitation to ${pending.email} revoked.`);
  });

  it('says invitations need email where it is off, and offers a retry when the list fails', async () => {
    let attempt = 0;
    stubFetch({
      [CAPABILITIES]: offers(false),
      [APPS]: apps,
      [LIST]: () => (attempt++ === 0 ? failure(503, 'down') : ok({ items: [], total: 0 })),
    });
    renderRoute('/admin/invitations');
    expect(await screen.findByText(/invitations cannot be sent/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Invite someone' })).toBeNull();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No pending invitations.')).toBeInTheDocument();
  });

  it('holds every row back while one action is on its way (no double send)', async () => {
    const revoking = deferred<Response>();
    stubFetch({
      [CAPABILITIES]: offers(true),
      [APPS]: apps,
      [LIST]: () => ok({ items: [pending], total: 1 }),
      [`DELETE /api/admin/invitations/${pending.id}`]: () => revoking.promise,
    });
    renderRoute('/admin/invitations');
    const user = userEvent.setup();
    const revoke = await screen.findByRole('button', {
      name: `Revoke the invitation to ${pending.email}`,
    });
    await user.click(revoke);
    expect(revoke).toBeDisabled();
    expect(screen.getByRole('button', { name: `Send again to ${pending.email}` })).toBeDisabled();
    revoking.resolve(new Response(null, { status: 204 }));
    expect(await screen.findByRole('status')).toHaveTextContent('revoked');
  });

  it('offers the form while what the deployment offers is unknown (the API still answers 503)', async () => {
    stubFetch({
      [CAPABILITIES]: () => failure(503, 'down'),
      [APPS]: apps,
      [LIST]: () => ok({ items: [], total: 0 }),
    });
    renderRoute('/admin/invitations');
    expect(await screen.findByRole('form', { name: 'Invite someone' })).toBeInTheDocument();
  });

  it('keeps members out', async () => {
    stubFetch({});
    setSession({ accessToken: 'member-token', expiresIn: 900, user: member });
    const router = renderRoute('/admin/invitations');
    await screen.findByRole('heading', { name: `Welcome, ${member.name}` });
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('AcceptInvitationPage', () => {
  const TOKEN = 'Iv5_c-Tn3'.padEnd(43, 'w');
  const LINK = `/accept-invitation#token=${TOKEN}`;
  const GOOD = 'violet harbour lantern 7';

  beforeEach(() => {
    clearSession();
  });

  async function accept(name: string, password: string) {
    await screen.findByRole('heading', { name: 'Accept your invitation' });
    const user = userEvent.setup();
    if (name) await user.type(screen.getByLabelText('Name'), name);
    if (password) await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Create my account' }));
  }

  it('creates the account with the chosen name and password, sets up its second factor, and carries on signed in', async () => {
    const { calls } = stubFetch({
      [ACCEPT]: () => challenge('enroll'),
      [ENROLL]: enrollment,
      [ENROLL_CONFIRM]: () => enrolled('token-new', member),
    });
    const router = renderRoute(LINK);
    await expect.poll(() => router.state.location.hash).toBe('');
    await accept(' Katherine Johnson ', GOOD);
    await setUpSecondFactor();
    expect(
      await screen.findByRole('heading', { name: `Welcome, ${member.name}` }),
    ).toBeInTheDocument();
    await expect(calls[0]?.json()).resolves.toEqual({
      token: TOKEN,
      name: 'Katherine Johnson',
      password: GOOD,
    });
    expect(getAccessToken()).toBe('token-new');
  });

  it('checks both fields before calling the API', async () => {
    const { fetchMock } = stubFetch({});
    renderRoute(LINK);
    await accept('', 'short');
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 15 characters (5 now).')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for another password when the API refuses it, keeping the form', async () => {
    stubFetch({ [ACCEPT]: () => failure(400, 'password: too common') });
    renderRoute(LINK);
    await accept('Katherine Johnson', 'correct horse battery staple');
    expect(await screen.findByText(/Choose another password/)).toBeInTheDocument();
    expect(getState().status).toBe('anonymous');
  });

  it.each([
    [404, 'This invitation does not work', 'already used, has expired, or was revoked'],
    [409, 'You already have an account', 'An account with this address exists'],
  ])('explains a %i', async (status, heading, shown) => {
    stubFetch({ [ACCEPT]: () => failure(status, 'refused') });
    renderRoute(LINK);
    await accept('Katherine Johnson', GOOD);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(shown, { exact: false })).toBeInTheDocument();
  });

  it('keeps the form when the server fails, and explains a cut link', async () => {
    stubFetch({ [ACCEPT]: () => failure(503, 'down') });
    renderRoute(LINK);
    await accept('Katherine Johnson', GOOD);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable');
    expect(screen.getByRole('button', { name: 'Create my account' })).toBeEnabled();
  });

  it('explains an incomplete link, sending nothing', async () => {
    const { fetchMock } = stubFetch({});
    renderRoute('/accept-invitation#token=cut');
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is incomplete.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

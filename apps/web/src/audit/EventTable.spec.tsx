import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth';
import { resetForTests, setSession } from '../auth/session';
import { eventSummary, fullEvent, RECORDED, SHOP } from '../test/events';
import { failure, ok, stubFetch } from '../test/http';
import { Badge, EventTable, RiskBadge } from './EventTable';
import { formatDateTime, formatWhen } from './format';

const viewer: AuthUser = {
  id: '0190b6a1-0000-7000-8000-000000000004',
  email: 'viewer@example.com',
  name: 'Viewer',
  role: 'viewer',
};
const EVENT = fullEvent.id;
const DETAIL = `GET /api/events/${EVENT}`;

function inRouter(element: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element }]);
  render(<RouterProvider router={router} />);
}

const rows = () => screen.getAllByRole('row').slice(1);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole('cell');
const WHEN = formatWhen(RECORDED);

beforeEach(() => {
  resetForTests();
  setSession({ accessToken: 'token-1', expiresIn: 900, user: viewer });
});
afterEach(() => {
  resetForTests();
});

describe('EventTable', () => {
  it('shows each event at a glance: when, who, what in words, where, how it ended and its risk', () => {
    inRouter(<EventTable events={[eventSummary({ id: EVENT })]} caption="Latest events" />);
    expect(screen.getByRole('table', { name: 'Latest events' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Date and time',
      'Actor',
      'Action',
      'Application',
      'Outcome',
      'Risk',
      'Details',
    ]);
    const cells = cellsOf(rows()[0]!);
    expect(cells.map((cell) => cell.textContent)).toEqual([
      WHEN,
      'Ann Exampleuser-42',
      'An order changed.order.updated',
      'shop',
      'success',
      'info · 0',
      'View details',
    ]);
    // The full date and time on hover; the instant for machines.
    const time = within(cells[0]!).getByText(WHEN);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', RECORDED);
    expect(time).toHaveAttribute('title', formatDateTime(RECORDED));
    expect(within(cells[1]!).getByRole('link', { name: 'user-42' })).toHaveAttribute(
      'href',
      `/apps/${SHOP}/actors/user-42`,
    );
    expect(within(cells[2]!).getByText('order.updated')).toHaveClass('mono', 'muted');
    expect(within(cells[4]!).getByText('success')).toHaveClass('badge', 'outcome-success');
    expect(within(cells[5]!).getByText('info · 0')).toHaveClass('badge', 'risk', 'sev-info');
    // Each button is named by its row, starting with its visible words.
    expect(
      screen.getByRole('button', { name: `View details An order changed. ${WHEN}` }),
    ).toBeInTheDocument();
  });

  it('names an actor by id or type without a label, and an action by its key without words', () => {
    inRouter(
      <EventTable
        events={[
          eventSummary({
            description: null,
            actor: { type: 'user', id: 'user-1', role: null, label: null },
          }),
          eventSummary({
            id: '0190b6a1-0000-7000-8000-0000000000e3',
            actor: { type: 'system', id: null, role: null, label: null },
          }),
          eventSummary({
            id: '0190b6a1-0000-7000-8000-0000000000e4',
            actor: { type: 'user', id: null, role: null, label: 'Grace' },
          }),
        ]}
        caption="Events"
      />,
    );
    const [unnamed, system, labelled] = rows();
    expect(cellsOf(unnamed!)[1]).toHaveTextContent(/^user-1$/);
    // The action's key, as words.
    expect(cellsOf(unnamed!)[2]).toHaveTextContent(/^order\.updated$/);
    expect(within(cellsOf(system!)[1]!).getByText('system')).toHaveClass('muted');
    expect(cellsOf(labelled!)[1]).toHaveTextContent(/^Grace$/);
  });

  it('colors outcomes: success green, failure red, denied orange; risk by severity', () => {
    inRouter(
      <EventTable
        events={(['success', 'failure', 'denied'] as const).map((outcome, index) =>
          eventSummary({
            id: `0190b6a1-0000-7000-8000-00000000000${String(index)}`,
            outcome,
            severity: index === 2 ? 'critical' : 'high',
            riskScore: 60 + index * 10,
          }),
        )}
        caption="Events"
      />,
    );
    expect(screen.getByText('success')).toHaveClass('outcome-success');
    expect(screen.getByText('failure')).toHaveClass('outcome-failure');
    expect(screen.getByText('denied')).toHaveClass('outcome-denied');
    expect(screen.getByText('high · 70')).toHaveClass('sev-high');
    expect(screen.getByText('critical · 80')).toHaveClass('sev-critical');
  });

  it('shows values off the patterns as text, never as links or attributes', () => {
    inRouter(
      <EventTable
        events={[
          eventSummary({
            id: 'not-a-uuid',
            recordedAt: 'not a date',
            actor: { type: 'user', id: 'bad id!', role: null, label: null },
          }),
          eventSummary({
            id: '0190b6a1-0000-7000-8000-0000000000e2',
            actor: { type: 'user', id: 'javascript:alert(1)', role: null, label: '<b>x</b>' },
          }),
        ]}
        caption="Events"
      />,
    );
    const [odd, hostile] = rows();
    expect(within(odd!).queryAllByRole('link')).toEqual([]);
    expect(within(odd!).getByText('bad id!')).toHaveClass('mono');
    // Not an instant: plain text, in no attribute.
    expect(within(odd!).getByText('not a date').tagName).toBe('SPAN');
    expect(within(hostile!).queryAllByRole('link')).toEqual([]);
    expect(within(hostile!).getByText('javascript:alert(1)').tagName).toBe('SPAN');
    expect(within(hostile!).getByText('<b>x</b>').tagName).toBe('SPAN');
    for (const element of document.body.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value).not.toContain('alert(1)');
        expect(attribute.value).not.toContain('not a date');
      }
    }
  });

  it('leaves out the application column when the page is about one', () => {
    inRouter(<EventTable events={[eventSummary()]} caption="Events" showApp={false} />);
    expect(screen.queryByRole('columnheader', { name: 'Application' })).toBeNull();
    expect(screen.queryByText('shop')).toBeNull();
    expect(cellsOf(rows()[0]!)).toHaveLength(6);
  });

  it('says when no event matches', () => {
    inRouter(<EventTable events={[]} caption="Events" />);
    expect(screen.getByText('No events match.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('EventTable, the detail drawer', () => {
  const table = () => {
    inRouter(<EventTable events={[eventSummary({ id: EVENT })]} caption="Events" />);
  };
  const button = () => screen.getByRole('button', { name: /^View details/ });

  it('asks for the event only when opened, shows all of it, and gives the focus back when closed', async () => {
    const { fetchMock } = stubFetch({ [DETAIL]: () => ok(fullEvent) });
    table();
    expect(fetchMock).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(button());

    const dialog = await screen.findByRole('dialog', { name: 'Event detail' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledOnce();
    const view = within(dialog);
    expect(
      await view.findByRole('heading', { level: 3, name: 'A user changed their password.' }),
    ).toBeInTheDocument();
    for (const name of [
      'Actor',
      'Network and location',
      'Request',
      'Client',
      'Audit and integrity',
      'Resource',
      'Change',
      'Details',
    ]) {
      expect(view.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(view.getByRole('heading', { level: 4, name: 'Actor' })).toBeInTheDocument();
    expect(view.getByText('ab'.repeat(32))).toBeInTheDocument();
    expect(view.getByRole('link', { name: 'Open as a page' })).toHaveAttribute(
      'href',
      `/events/${EVENT}`,
    );
    // The events of the same request are on the page, not in a drawer of a drawer.
    expect(view.queryByRole('table')).toBeNull();
    expect(
      view.getByText(/One more event has the same request id/, { selector: 'p' }),
    ).toHaveTextContent(
      'One more event has the same request id: open the event as a page to see them.',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('keeps the focus inside while open, and closes with its button', async () => {
    stubFetch({ [DETAIL]: () => ok({ ...fullEvent, related: [] }) });
    table();
    const user = userEvent.setup();
    await user.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Event detail' });
    await within(dialog).findByRole('heading', { level: 3 });
    const page = within(dialog).getByRole('link', { name: 'Open as a page' });
    // From the dialog itself, back to its last control; from that, to its first.
    await user.tab({ shift: true });
    const last = document.activeElement;
    expect(dialog).toContainElement(last as HTMLElement);
    expect(last).not.toBe(page);
    await user.tab();
    expect(page).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('explains a failure, and retries on demand', async () => {
    let attempt = 0;
    stubFetch({
      [DETAIL]: () => (attempt++ === 0 ? failure(503, 'down') : ok({ ...fullEvent, related: [] })),
    });
    table();
    const user = userEvent.setup();
    await user.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Event detail' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The service is unavailable',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await within(dialog).findByRole('heading', { level: 3 })).toHaveTextContent(
      'A user changed their password.',
    );
  });
});

describe('Badge', () => {
  it('styles a known word by its kind, written as words', () => {
    render(
      <>
        <Badge kind="sev" value="critical" />
        <Badge kind="status" value="false_positive" />
      </>,
    );
    expect(screen.getByText('critical')).toHaveAttribute('class', 'badge sev-critical');
    expect(screen.getByText('false positive')).toHaveAttribute(
      'class',
      'badge status-false_positive',
    );
  });

  it('shows anything else unstyled, as text', () => {
    render(
      <>
        <Badge kind="outcome" value="Weird Value" />
        <Badge kind="sev" value={'x" onclick="alert(1)'} />
        <Badge kind="status" value={'a'.repeat(33)} />
        <RiskBadge severity="Not One" score={5} />
      </>,
    );
    expect(screen.getByText('Weird Value')).toHaveAttribute('class', 'badge');
    expect(screen.getByText('x" onclick="alert(1)')).toHaveAttribute('class', 'badge');
    expect(screen.getByText('x" onclick="alert(1)')).not.toHaveAttribute('onclick');
    expect(screen.getByText('a'.repeat(33))).toHaveAttribute('class', 'badge');
    expect(screen.getByText('Not One · 5')).toHaveAttribute('class', 'badge risk');
  });
});

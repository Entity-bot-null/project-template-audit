import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BarList, Heatmap, Sparkline, TimeSeriesChart } from './charts';

// Every chart has a title, a description and its numbers as a table: a
// chart is never the only way to read them (docs/adr/0014).

const tableOf = (figure: HTMLElement) => within(figure).getByRole('table', { hidden: true });
const rowsOf = (figure: HTMLElement) =>
  within(tableOf(figure))
    .getAllByRole('row', { hidden: true })
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell', { hidden: true })
        .map((cell) => cell.textContent),
    );
const pathOf = (figure: HTMLElement, name: 'line' | 'area') =>
  figure.querySelector(`path.chart-${name}`)?.getAttribute('d');

describe('TimeSeriesChart', () => {
  const POINTS = [
    { label: 'Oct 1', value: 0 },
    { label: 'Oct 2', value: 5 },
    { label: 'Oct 3', value: 10 },
  ];

  it('draws a line over its area through every point, oldest first', () => {
    render(<TimeSeriesChart title="Events per day" description="Last 3 days" points={POINTS} />);
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('Events per day')).toBeInTheDocument();
    expect(within(figure).getByText('Last 3 days')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Events per day: 15 in total, at most 10' }),
    ).toBeInTheDocument();
    expect(pathOf(figure, 'line')).toBe('M0.0,160.0L300.0,84.0L600.0,8.0');
    expect(pathOf(figure, 'area')).toBe('M0.0,160.0L300.0,84.0L600.0,8.0L600,160L0,160Z');
    // The axis: the first and last labels, and the top of the scale.
    const axis = figure.querySelector('.chart-axis');
    expect([...(axis?.children ?? [])].map((span) => span.textContent)).toEqual([
      'Oct 1',
      'max 10',
      'Oct 3',
    ]);
  });

  it('draws a single point in the middle', () => {
    render(<TimeSeriesChart title="Today" points={[{ label: 'Oct 15', value: 1234 }]} />);
    const figure = screen.getByRole('figure');
    expect(
      screen.getByRole('img', { name: 'Today: 1,234 in total, at most 1,234' }),
    ).toBeInTheDocument();
    expect(pathOf(figure, 'line')).toBe('M300.0,8.0');
    expect(figure.querySelector('.chart-description')).toBeNull();
    expect(rowsOf(figure)).toEqual([['Oct 15', '1,234']]);
  });

  it('draws nothing without points, on a scale that still starts at one', () => {
    render(<TimeSeriesChart title="Nothing" points={[]} />);
    const figure = screen.getByRole('figure');
    expect(screen.getByRole('img', { name: 'Nothing: 0 in total, at most 1' })).toBeInTheDocument();
    expect(pathOf(figure, 'line')).toBe('');
    expect(pathOf(figure, 'area')).toBe('');
    const axis = figure.querySelector('.chart-axis');
    expect([...(axis?.children ?? [])].map((span) => span.textContent)).toEqual(['', 'max 1', '']);
    expect(rowsOf(figure)).toEqual([]);
  });

  it('shows its numbers as a table, with the headings it is given', async () => {
    render(
      <TimeSeriesChart
        title="Events per hour"
        points={POINTS}
        labelHeading="Hour"
        valueHeading="Events"
      />,
    );
    const figure = screen.getByRole('figure');
    const table = tableOf(figure);
    expect(table).not.toBeVisible();
    await userEvent.setup().click(within(figure).getByText('Show as a table'));
    expect(table).toBeVisible();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Hour', 'Events']);
    expect(rowsOf(figure)).toEqual([
      ['Oct 1', '0'],
      ['Oct 2', '5'],
      ['Oct 3', '10'],
    ]);
  });

  it('heads the table Time and Count by default', () => {
    render(<TimeSeriesChart title="Events" points={POINTS} />);
    expect(
      within(tableOf(screen.getByRole('figure')))
        .getAllByRole('columnheader', { hidden: true })
        .map((cell) => cell.textContent),
    ).toEqual(['Time', 'Count']);
  });
});

describe('BarList', () => {
  const ITEMS = [
    { label: '203.0.113.7', value: 1200 },
    { label: '198.51.100.2', value: 300 },
  ];

  it('ranks the items, each bar its share of the largest', () => {
    render(
      <BarList
        title="Addresses"
        description="Failed sign-ins"
        items={ITEMS}
        labelHeading="Address"
        valueHeading="Failures"
      />,
    );
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('Failed sign-ins')).toBeInTheDocument();
    const items = within(figure).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['203.0.113.71,200', '198.51.100.2300']);
    expect(
      [...figure.querySelectorAll('rect.bar-fill')].map((bar) => bar.getAttribute('width')),
    ).toEqual(['100', '25']);
    // The bars repeat the numbers: hidden from assistive technology.
    expect(figure.querySelector('svg.bar')).toHaveAttribute('aria-hidden', 'true');
    expect(
      within(tableOf(figure))
        .getAllByRole('columnheader', { hidden: true })
        .map((cell) => cell.textContent),
    ).toEqual(['Address', 'Failures']);
    expect(rowsOf(figure)).toEqual([
      ['203.0.113.7', '1,200'],
      ['198.51.100.2', '300'],
    ]);
  });

  it('says when there is nothing, in its own words or the default ones', () => {
    const { unmount } = render(<BarList title="Countries" items={[]} />);
    let figure = screen.getByRole('figure');
    expect(within(figure).getByText('Nothing yet.')).toBeInTheDocument();
    expect(within(figure).queryByRole('list')).toBeNull();
    expect(
      within(tableOf(figure))
        .getAllByRole('columnheader', { hidden: true })
        .map((cell) => cell.textContent),
    ).toEqual(['Item', 'Count']);
    expect(rowsOf(figure)).toEqual([]);
    unmount();

    render(<BarList title="Rules" items={[]} empty="No rule fired." />);
    figure = screen.getByRole('figure');
    expect(within(figure).getByText('No rule fired.')).toBeInTheDocument();
  });

  it('draws bars of zero on a scale that starts at one', () => {
    render(<BarList title="Quiet" items={[{ label: 'none', value: 0 }]} />);
    expect(screen.getByRole('figure').querySelector('rect.bar-fill')).toHaveAttribute('width', '0');
  });
});

describe('Heatmap', () => {
  it('shades the busy hours by their share of the busiest, and lists them', () => {
    render(
      <Heatmap
        title="Sign-ins"
        description="By day and hour, UTC"
        cells={[
          { dow: 1, hour: 9, count: 4 },
          { dow: 1, hour: 10, count: 0 },
          { dow: 6, hour: 23, count: 2 },
          // Not a day of the week: listed by its number, not drawn.
          { dow: 9, hour: 3, count: 1 },
        ]}
      />,
    );
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('By day and hour, UTC')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sign-ins: busiest hour 4' })).toBeInTheDocument();

    const cells = figure.querySelectorAll('rect.heat-cell');
    expect(cells).toHaveLength(7 * 24);
    expect(figure.querySelectorAll('rect.heat-empty')).toHaveLength(7 * 24 - 2);
    const busy = [...cells].filter((cell) => !cell.classList.contains('heat-empty'));
    expect(
      busy.map((cell) => [
        cell.getAttribute('x'),
        cell.getAttribute('y'),
        cell.getAttribute('fill-opacity'),
      ]),
    ).toEqual([
      ['107.5', '10', '1'],
      ['240.5', '60', '0.575'],
    ]);
    expect(figure.querySelector('rect.heat-empty')).not.toHaveAttribute('fill-opacity');
    expect(
      [...figure.querySelectorAll('text.heatmap-label')].map((label) => label.textContent),
    ).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

    expect(
      within(tableOf(figure))
        .getAllByRole('columnheader', { hidden: true })
        .map((cell) => cell.textContent),
    ).toEqual(['Day', 'Hour (UTC)', 'Count']);
    expect(rowsOf(figure)).toEqual([
      ['Mon', '09:00', '4'],
      ['Sat', '23:00', '2'],
      ['9', '03:00', '1'],
    ]);
  });

  it('says there was no activity instead of an empty table', () => {
    render(
      <Heatmap
        title="Quiet week"
        cells={[
          { dow: 0, hour: 0, count: 0 },
          { dow: 3, hour: 12, count: 0 },
        ]}
      />,
    );
    const figure = screen.getByRole('figure');
    expect(screen.getByRole('img', { name: 'Quiet week: busiest hour 1' })).toBeInTheDocument();
    expect(figure.querySelector('.chart-description')).toBeNull();
    expect(within(figure).queryByRole('table', { hidden: true })).toBeNull();
    expect(within(figure).getByText('No activity.')).toBeInTheDocument();
    expect(figure.querySelectorAll('rect.heat-empty')).toHaveLength(7 * 24);
  });

  it('draws an empty week without cells', () => {
    render(<Heatmap title="Nothing" cells={[]} />);
    expect(screen.getByRole('img', { name: 'Nothing: busiest hour 1' })).toBeInTheDocument();
    expect(screen.getByText('No activity.')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  const pointsOf = (name: string) =>
    screen.getByRole('img', { name }).querySelector('polyline')?.getAttribute('points');

  it('draws a trend whose numbers are in its label', () => {
    render(<Sparkline values={[1, 3, 2]} label="Events, 7 days" />);
    expect(pointsOf('Events, 7 days: 6 in total, at most 3')).toBe('0.0,14.0 50.0,2.0 100.0,8.0');
  });

  it('draws one value at the start, and none on a scale that starts at one', () => {
    render(
      <>
        <Sparkline values={[1500]} label="Once" />
        <Sparkline values={[]} label="Never" />
      </>,
    );
    expect(pointsOf('Once: 1,500 in total, at most 1,500')).toBe('0.0,2.0');
    expect(pointsOf('Never: 0 in total, at most 1')).toBe('');
  });
});

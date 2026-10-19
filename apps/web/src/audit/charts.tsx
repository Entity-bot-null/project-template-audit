import { type ReactNode, useId } from 'react';
import { formatNumber } from './format';

// The admin pages' charts (docs/adr/0014): a few SVG components, no library.
// Shapes are drawn with SVG attributes and colored by CSS classes (index.css),
// never inline styles, so the CSP stays as it is. Every chart has a title, a
// description and its numbers as a table: a chart is never the only way to
// read them.

export interface Point {
  label: string;
  value: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Frame({
  title,
  description,
  children,
  table,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  table: ReactNode;
}) {
  return (
    <figure className="chart">
      <figcaption>
        <strong>{title}</strong>
        {description !== undefined && <span className="chart-description">{description}</span>}
      </figcaption>
      {children}
      <details className="chart-table">
        <summary>Show as a table</summary>
        {table}
      </details>
    </figure>
  );
}

function PointsTable({
  points,
  labelHeading,
  valueHeading,
}: {
  points: Point[];
  labelHeading: string;
  valueHeading: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">{labelHeading}</th>
          <th scope="col">{valueHeading}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.label}>
            <td>{point.label}</td>
            <td>{formatNumber(point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const WIDTH = 600;
const HEIGHT = 160;

/** A value over time (one point per day or hour, oldest first), as a line over its area. */
export function TimeSeriesChart({
  title,
  description,
  points,
  labelHeading = 'Time',
  valueHeading = 'Count',
}: {
  title: string;
  description?: string;
  points: Point[];
  labelHeading?: string;
  valueHeading?: string;
}) {
  const titleId = useId();
  const max = Math.max(1, ...points.map((point) => point.value));
  const step = points.length > 1 ? WIDTH / (points.length - 1) : 0;
  const coordinates = points.map((point, index) => {
    const x = points.length > 1 ? index * step : WIDTH / 2;
    const y = HEIGHT - (point.value / max) * (HEIGHT - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coordinates.length > 0 ? `M${coordinates.join('L')}` : '';
  const area = coordinates.length > 0 ? `${line}L${WIDTH},${HEIGHT}L0,${HEIGHT}Z` : '';
  const total = points.reduce((sum, point) => sum + point.value, 0);
  return (
    <Frame
      title={title}
      description={description}
      table={
        <PointsTable points={points} labelHeading={labelHeading} valueHeading={valueHeading} />
      }
    >
      <svg
        className="chart-svg"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          {`${title}: ${formatNumber(total)} in total, at most ${formatNumber(max)}`}
        </title>
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line} />
      </svg>
      <div className="chart-axis">
        <span>{points[0]?.label ?? ''}</span>
        <span>max {formatNumber(max)}</span>
        <span>{points.at(-1)?.label ?? ''}</span>
      </div>
    </Frame>
  );
}

/** Ranked values (addresses, countries, rules), each with a bar for its share of the largest. */
export function BarList({
  title,
  description,
  items,
  labelHeading = 'Item',
  valueHeading = 'Count',
  empty = 'Nothing yet.',
}: {
  title: string;
  description?: string;
  items: Point[];
  labelHeading?: string;
  valueHeading?: string;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <Frame
      title={title}
      description={description}
      table={<PointsTable points={items} labelHeading={labelHeading} valueHeading={valueHeading} />}
    >
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ol className="bar-list">
          {items.map((item) => (
            <li key={item.label}>
              <span className="bar-label">{item.label}</span>
              <svg
                className="bar"
                viewBox="0 0 100 8"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect className="bar-track" width="100" height="8" />
                <rect className="bar-fill" width={(item.value / max) * 100} height="8" />
              </svg>
              <span className="bar-value">{formatNumber(item.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </Frame>
  );
}

/** Counts by day of the week (0 = Sunday) and hour, UTC: when something happens. */
export function Heatmap({
  title,
  description,
  cells,
}: {
  title: string;
  description?: string;
  cells: { dow: number; hour: number; count: number }[];
}) {
  const titleId = useId();
  const max = Math.max(1, ...cells.map((cell) => cell.count));
  const at = (dow: number, hour: number) =>
    cells.find((cell) => cell.dow === dow && cell.hour === hour)?.count ?? 0;
  const busy = cells.filter((cell) => cell.count > 0);
  return (
    <Frame
      title={title}
      description={description}
      table={
        busy.length === 0 ? (
          <p className="muted">No activity.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Hour (UTC)</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {busy.map((cell) => (
                <tr key={`${String(cell.dow)}-${String(cell.hour)}`}>
                  <td>{DAYS[cell.dow] ?? String(cell.dow)}</td>
                  <td>{`${String(cell.hour).padStart(2, '0')}:00`}</td>
                  <td>{formatNumber(cell.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    >
      <svg className="heatmap" viewBox="0 0 250 72" role="img" aria-labelledby={titleId}>
        <title id={titleId}>{`${title}: busiest hour ${formatNumber(max)}`}</title>
        {DAYS.map((day, dow) => (
          <g key={day}>
            <text className="heatmap-label" x="0" y={dow * 10 + 8}>
              {day}
            </text>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = at(dow, hour);
              return (
                <rect
                  key={hour}
                  className={count === 0 ? 'heat-cell heat-empty' : 'heat-cell'}
                  x={22 + hour * 9.5}
                  y={dow * 10}
                  width="8.5"
                  height="9"
                  fillOpacity={count === 0 ? undefined : 0.15 + 0.85 * (count / max)}
                />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="chart-axis">
        <span>00:00 UTC</span>
        <span>23:00</span>
      </div>
    </Frame>
  );
}

/** A small trend without axes, for tables: its numbers are in the label. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(20 - (value / max) * 18).toFixed(1)}`)
    .join(' ');
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${formatNumber(total)} in total, at most ${formatNumber(max)}`}
    >
      <polyline className="chart-line" points={points} />
    </svg>
  );
}

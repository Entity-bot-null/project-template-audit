import { createElement, type ReactNode } from 'react';

// The parts every detail view is made of (an event's, an alert's): headings
// one level below wherever the view is shown, cards of label and value pairs.

export type Level = 1 | 2 | 3 | 4;
type Row = readonly [string, ReactNode];

export const Heading = ({
  level,
  id,
  children,
}: {
  level: Level;
  id?: string;
  children: ReactNode;
}) => createElement(`h${String(level)}`, { id }, children);

/** Label and value pairs, leaving out the empty ones. */
export function Facts({ rows }: { rows: readonly Row[] }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (shown.length === 0) return <p className="muted">Nothing recorded.</p>;
  return (
    <dl className="details-grid">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({
  title,
  level,
  children,
}: {
  title: string;
  level: Level;
  children: ReactNode;
}) {
  return (
    <section className="card stack" aria-label={title}>
      <Heading level={level}>{title}</Heading>
      {children}
    </section>
  );
}

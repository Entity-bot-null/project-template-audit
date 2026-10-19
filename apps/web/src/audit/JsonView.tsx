import { Fragment, type ReactNode } from 'react';

const MAX_DEPTH = 8;
const INDENT = '  ';

/**
 * A JSON value (an event's details, a change's before and after) as
 * highlighted code: keys, strings, numbers, booleans and nulls each with a
 * class (index.css), indented by depth. Every key and string is a text node
 * of its JSON form, quoted and escaped (a hidden line break shows as \n),
 * never markup, a URL or a style (docs/adr/0014). Focusable, so a long value
 * scrolls from the keyboard.
 */
export function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="json-code" tabIndex={0}>
      <code>{tokens(value, 0)}</code>
    </pre>
  );
}

function tokens(value: unknown, depth: number): ReactNode {
  if (value === null || value === undefined) return <span className="json-null">null</span>;
  if (typeof value === 'string') {
    return <span className="json-string">{JSON.stringify(value)}</span>;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return <span className="json-number">{String(value)}</span>;
  }
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
  if (typeof value !== 'object') return <span className="json-null">(not shown)</span>;
  if (depth >= MAX_DEPTH) return <span className="json-null">…</span>;
  const inner = INDENT.repeat(depth + 1);
  const outer = INDENT.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return (
      <>
        {'[\n'}
        {value.map((item: unknown, index) => (
          // Positions are the identity of a JSON array's items.
          <Fragment key={index}>
            {inner}
            {tokens(item, depth + 1)}
            {index < value.length - 1 ? ',\n' : '\n'}
          </Fragment>
        ))}
        {`${outer}]`}
      </>
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return (
    <>
      {'{\n'}
      {entries.map(([key, item], index) => (
        <Fragment key={key}>
          {inner}
          <span className="json-key">{JSON.stringify(key)}</span>
          {': '}
          {tokens(item as unknown, depth + 1)}
          {index < entries.length - 1 ? ',\n' : '\n'}
        </Fragment>
      ))}
      {`${outer}}`}
    </>
  );
}

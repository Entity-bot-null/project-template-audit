import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JsonView } from './JsonView';

const show = (value: unknown) => render(<JsonView value={value} />).container;
/** The whole text, as a reader or a copy of it gets it. */
const textOf = (container: HTMLElement) => container.querySelector('pre')?.textContent ?? '';
const classed = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll(`.${name}`)].map((element) => element.textContent);

// Events carry whatever an application sent: every string must end up as
// text, never markup, a URL or a style (docs/adr/0014).
describe('JsonView and hostile values', () => {
  const HOSTILE = [
    '<script>alert(1)</script>',
    '${alert(1)}',
    '" onmouseover="alert(1)',
    'javascript:alert(1)',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">click</a>',
  ];

  function hostileDocument() {
    const flat = Object.fromEntries(HOSTILE.map((text) => [text, text]));
    return {
      ...flat,
      nested: { ...flat, deeper: { list: [...HOSTILE, { ...flat }] } },
      list: [...HOSTILE, [...HOSTILE]],
    };
  }

  it('renders every key and value as its exact JSON text', () => {
    const container = show(hostileDocument());
    for (const text of HOSTILE) {
      const quoted = JSON.stringify(text);
      // As a key at the top, in `nested` and `nested.deeper.list[n]`.
      expect(
        classed(container, 'json-key').filter((key) => key === quoted),
        text,
      ).toHaveLength(3);
      // As a value there, and in the lists.
      expect(
        classed(container, 'json-string').filter((value) => value === quoted).length,
        text,
      ).toBeGreaterThanOrEqual(6);
    }
    // The whole is the JSON itself: what a reader copies parses back.
    expect(JSON.parse(textOf(container))).toEqual(hostileDocument());
  });

  it('creates no element or attribute that could run, load or link anything', () => {
    const container = show(hostileDocument());
    expect(
      container.querySelectorAll('script, a, img, iframe, object, embed, style, link, svg, form'),
    ).toHaveLength(0);
    const elements = [...container.querySelectorAll('*')];
    expect(new Set(elements.map((element) => element.tagName.toLowerCase()))).toEqual(
      new Set(['pre', 'code', 'span']),
    );
    for (const element of elements) {
      for (const attribute of element.getAttributeNames()) {
        expect(['class', 'tabindex'], `${element.tagName} ${attribute}`).toContain(attribute);
      }
    }
  });

  it('shows a hidden line break or control character escaped, not as layout', () => {
    const container = show({ note: 'first\nsecond\u0000' });
    expect(classed(container, 'json-string')).toEqual(['"first\\nsecond\\u0000"']);
  });
});

describe('JsonView', () => {
  it('indents objects and arrays by depth, and highlights each kind of value', () => {
    const container = show({ actor: { id: 'user-1', roles: ['admin', 'auditor'] }, count: 2 });
    expect(textOf(container)).toBe(
      JSON.stringify({ actor: { id: 'user-1', roles: ['admin', 'auditor'] }, count: 2 }, null, 2),
    );
    expect(classed(container, 'json-key')).toEqual(['"actor"', '"id"', '"roles"', '"count"']);
    expect(classed(container, 'json-string')).toEqual(['"user-1"', '"admin"', '"auditor"']);
    expect(classed(container, 'json-number')).toEqual(['2']);
  });

  it('writes literals as JSON does, and nothing as null', () => {
    const container = show([42, -1.5, true, false, 10n, null, undefined]);
    expect(classed(container, 'json-number')).toEqual(['42', '-1.5', '10']);
    expect(classed(container, 'json-boolean')).toEqual(['true', 'false']);
    expect(classed(container, 'json-null')).toEqual(['null', 'null']);
  });

  it('shows a value on its own: null, a string, an empty array or object', () => {
    const { container, rerender } = render(<JsonView value={null} />);
    expect(screen.getByText('null')).toHaveClass('json-null');
    rerender(<JsonView value={undefined} />);
    expect(screen.getByText('null')).toBeInTheDocument();
    rerender(<JsonView value="" />);
    expect(container.querySelector('.json-string')).toHaveTextContent('""');
    rerender(<JsonView value={[]} />);
    expect(textOf(container)).toBe('[]');
    rerender(<JsonView value={{}} />);
    expect(textOf(container)).toBe('{}');
  });

  it('does not show what JSON cannot hold: functions and symbols', () => {
    show({ run: () => 'secret', tag: Symbol('tag') });
    expect(screen.getAllByText('(not shown)')).toHaveLength(2);
    expect(screen.queryByText(/secret/)).toBeNull();
    expect(screen.queryByText(/tag\)/)).toBeNull();
  });

  it('stops at eight levels deep, arrays counted', () => {
    let value: unknown = 'bottom';
    for (let level = 0; level < 10; level += 1) value = { [`level${String(9 - level)}`]: value };
    const container = show(value);
    expect(classed(container, 'json-key')).toHaveLength(8);
    expect(screen.getByText('"level7"')).toBeInTheDocument();
    expect(screen.queryByText('"level8"')).toBeNull();
    expect(screen.queryByText(/bottom/)).toBeNull();
    expect(screen.getByText('…')).toHaveClass('json-null');

    let nested: unknown = 'bottom';
    for (let level = 0; level < 9; level += 1) nested = [nested];
    const arrays = show(nested);
    expect(arrays.querySelector('.json-null')).toHaveTextContent('…');
  });

  it('can be reached from the keyboard, to scroll a long value', () => {
    const container = show({ long: 'x'.repeat(500) });
    expect(container.querySelector('pre')).toHaveAttribute('tabindex', '0');
  });
});

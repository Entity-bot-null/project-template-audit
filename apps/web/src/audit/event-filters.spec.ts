import { describe, expect, it } from 'vitest';
import { FILTER_NAMES, filtersOf } from './event-filters';

describe('filtersOf', () => {
  it('reads the filters a URL holds, by the names the API takes', () => {
    const params = new URLSearchParams(
      'appId=0190b6a1-0000-7000-8000-00000000000a&severity=high&actorId=user-1&from=2026-10-01T00%3A00%3A00.000Z',
    );
    expect(filtersOf(params)).toEqual({
      appId: '0190b6a1-0000-7000-8000-00000000000a',
      severity: 'high',
      actorId: 'user-1',
      from: '2026-10-01T00:00:00.000Z',
    });
  });

  it('leaves out empty values and anything that is not a filter', () => {
    const params = new URLSearchParams('appId=&outcome=&cursor=abc&limit=50&unknown=1&ip=10.0.0.1');
    expect(filtersOf(params)).toEqual({ ip: '10.0.0.1' });
    expect(filtersOf(new URLSearchParams())).toEqual({});
  });

  it('reads every filter name', () => {
    const params = new URLSearchParams(FILTER_NAMES.map((name) => [name, `${name}-value`]));
    expect(Object.keys(filtersOf(params))).toEqual([...FILTER_NAMES]);
    expect(FILTER_NAMES).toContain('requestId');
    expect(FILTER_NAMES).not.toContain('cursor');
  });
});

import { describe, expect, it } from 'vitest';
import { ACCEPT_CLIENT_HINTS, clientHintsFromHeaders } from './client-hints.js';

const from = (headers: Record<string, string>) => clientHintsFromHeaders((name) => headers[name]);

// What browsers send, copied from their requests.
const EDGE_ON_LINUX = {
  'sec-ch-ua': '"Microsoft Edge";v="155", "Chromium";v="155", "Not.A/Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
};

describe('clientHintsFromHeaders', () => {
  it('reads the low-entropy hints every Chromium sends, without the GREASE brand', () => {
    expect(from(EDGE_ON_LINUX)).toEqual({
      brands: [
        { brand: 'Microsoft Edge', version: '155' },
        { brand: 'Chromium', version: '155' },
      ],
      platform: 'Linux',
      mobile: false,
    });
  });

  it('prefers the full version list, and reads the platform version and the model when asked for', () => {
    expect(
      from({
        ...EDGE_ON_LINUX,
        'sec-ch-ua-full-version-list':
          '"Not)A;Brand";v="8.0.0.0", "Brave";v="141.1.83.112", "Chromium";v="141.0.7390.65"',
        'sec-ch-ua-platform': '"Windows"',
        'sec-ch-ua-platform-version': '"15.0.0"',
        'sec-ch-ua-model': '""',
        'sec-ch-ua-mobile': '?1',
      }),
    ).toEqual({
      brands: [
        { brand: 'Brave', version: '141.1.83.112' },
        { brand: 'Chromium', version: '141.0.7390.65' },
      ],
      platform: 'Windows',
      platformVersion: '15.0.0',
      mobile: true,
    });
    expect(from({ 'sec-ch-ua-model': '"Pixel 9"' })).toEqual({ model: 'Pixel 9' });
  });

  it('answers nothing for a request without hints, and leaves out what is malformed', () => {
    expect(from({})).toBeUndefined();
    expect(from({ 'sec-ch-ua': 'garbage', 'sec-ch-ua-mobile': '?2' })).toBeUndefined();
    expect(from({ 'sec-ch-ua': '"Brand";v=""', 'sec-ch-ua-platform': '""' })).toBeUndefined();
    // Escaped quotes stay text.
    expect(from({ 'sec-ch-ua': '"Odd \\"Name\\"";v="1"' })).toEqual({
      brands: [{ brand: 'Odd "Name"', version: '1' }],
    });
  });

  it('bounds what it reads: long values cut, a few brands at most', () => {
    const many = Array.from({ length: 20 }, (_, index) => `"B${String(index)}";v="1"`).join(', ');
    expect(from({ 'sec-ch-ua': many })?.brands).toHaveLength(8);
    const long = from({ 'sec-ch-ua-platform': `"${'P'.repeat(10_000)}"` });
    expect(long?.platform).toHaveLength(32);
  });

  it('names the hints a page asks for', () => {
    expect(ACCEPT_CLIENT_HINTS).toBe(
      'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Model',
    );
  });
});

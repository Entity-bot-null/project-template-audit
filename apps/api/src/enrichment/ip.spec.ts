import { describe, expect, it } from 'vitest';
import { canonicalIp, ipScope } from './ip.js';

describe('canonicalIp', () => {
  it('writes every address one way', () => {
    expect(canonicalIp('203.0.113.7')).toBe('203.0.113.7');
    expect(canonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(canonicalIp('::ffff:192.0.2.128')).toBe('192.0.2.128');
    expect(canonicalIp('::1')).toBe('::1');
    expect(canonicalIp('unknown')).toBeUndefined();
    expect(canonicalIp('999.1.1.1')).toBeUndefined();
  });
});

describe('ipScope', () => {
  it.each([
    ['8.8.8.8', 'public'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.20.0.1', 'private'],
    ['192.168.1.1', 'private'],
    ['169.254.10.1', 'link_local'],
    ['100.64.1.1', 'shared'],
    ['203.0.113.7', 'reserved'],
    ['198.18.0.5', 'reserved'],
    ['224.0.0.1', 'reserved'],
    ['0.1.2.3', 'reserved'],
    ['2a00:1450::1', 'public'],
    ['::1', 'loopback'],
    ['::', 'reserved'],
    ['fd00::1', 'private'],
    ['fe80::1', 'link_local'],
    ['2001:db8::1', 'reserved'],
    ['ff02::1', 'reserved'],
  ] as const)('%s is %s', (ip, scope) => {
    expect(ipScope(ip)).toBe(scope);
  });
});
